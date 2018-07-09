import RamlWrapper1= require("../parser/artifacts/raml10parserapi")
import RamlWrapper1Impl= require("../parser/artifacts/raml10parser")

import RamlWrapper08= require("../parser/artifacts/raml08parserapi")

import path=require("path")
import jsonTypings = require("../typings-new-format/raml");
import Opt = require('../Opt')
import jsyaml=require("../parser/jsyaml/jsyaml2lowLevel")
import hl=require("../parser/highLevelAST")
import hlimpl=require("../parser/highLevelImpl")
import ll=require("../parser/lowLevelAST")
import llimpl=require("../parser/jsyaml/jsyaml2lowLevel")
import expanderLL=require("../parser/ast.core/expanderLL")
import util=require("../util/index")
import universeDef=require("../parser/tools/universe")
import parserCore=require('../parser/wrapped-ast/parserCore')
import parserCoreApi=require('../parser/wrapped-ast/parserCoreApi')
import ramlServices = require("../parser/definition-system/ramlServices")
import jsonSerializerHL = require("../util/jsonSerializerHL")
import universeHelpers = require("./tools/universeHelpers");
import search = require("./../search/search-interface");
import linter=require("./ast.core/linter")
import resolversApi = require("./jsyaml/resolversApi");
let messageRegistry = require("../../resources/errorMessages");

export type IHighLevelNode=hl.IHighLevelNode;
export type IParseResult=hl.IParseResult;

import universeProvider=require("../parser/definition-system/universeProvider")

export function load(ramlPathOrContent:string,options?:parserCoreApi.LoadOptions):Promise<jsonTypings.RAMLParseResult>{
    let serializeOptions = toNewFormatSerializeOptions(options);
    return parse(ramlPathOrContent,options).then(expanded=>{
        return jsonSerializerHL.dump(expanded,serializeOptions);
    });
}

export function loadSync(ramlPathOrContent:string,options?:parserCoreApi.LoadOptions):jsonTypings.RAMLParseResult{
    let serializeOptions = toNewFormatSerializeOptions(options);
    let expanded = parseSync(ramlPathOrContent,options);
    return jsonSerializerHL.dump(expanded,serializeOptions);
}

export function parse(ramlPathOrContent:string,options?:parserCoreApi.LoadOptions):Promise<hl.IHighLevelNode>{
    options = options || {};
    let filePath = ramlPathOrContent;
    if(consideredAsRamlContent(ramlPathOrContent)){
        options = loadOptionsForContent(ramlPathOrContent,options,options.filePath);
        filePath = virtualFilePath(options);
    }
    let loadRAMLOptions = toOldStyleOptions(options);
    return loadRAMLAsyncHL(filePath,loadRAMLOptions).then(hlNode=>{
        var expanded:hl.IHighLevelNode;
        if(!options.hasOwnProperty("expandLibraries") || options.expandLibraries) {
            expanded = expanderLL.expandLibrariesHL(hlNode);
        }
        else{
            expanded = expanderLL.expandTraitsAndResourceTypesHL(hlNode);
        }
        return expanded;
    });
}

export function parseSync(ramlPathOrContent:string,options?:parserCoreApi.LoadOptions):hl.IHighLevelNode{
    options = options || {};
    let filePath = ramlPathOrContent;
    if(consideredAsRamlContent(ramlPathOrContent)){
        options = loadOptionsForContent(ramlPathOrContent,options,options.filePath);
        filePath = virtualFilePath(options);
    }
    let loadRAMLOptions = toOldStyleOptions(options);
    let hlNode = loadRAMLInternalHL(filePath,loadRAMLOptions);
    let expanded:hl.IHighLevelNode;
    if (!options.hasOwnProperty("expandLibraries") || options.expandLibraries) {
        if(universeHelpers.isLibraryType(hlNode.definition())){
            expanded = expanderLL.expandLibraryHL(hlNode) || hlNode;
        }
        else {
            expanded = expanderLL.expandLibrariesHL(hlNode) || hlNode;
        }
    }
    else {
        expanded = expanderLL.expandTraitsAndResourceTypesHL(hlNode)||hlNode;
    }
    return expanded;
}

/***
 * Load API synchronously. Detects RAML version and uses corresponding parser.
 * @param apiPath Path to API: local file system path or Web URL
 * @param options Load options
 * @return Opt&lt;Api&gt;, where Api belongs to RAML 1.0 or RAML 0.8 model.
 ***/
export function loadApi(apiPath:string,arg1?:string[]|parserCoreApi.Options,arg2?:string[]|parserCoreApi.Options):Opt<RamlWrapper1.Api|RamlWrapper08.Api>{

    var hlNode = loadRAMLInternalHL(apiPath,arg1,arg2);
    if(!hlNode) {
        return Opt.empty< RamlWrapper1.Api | RamlWrapper08.Api >();
    }
    var api = <any>hlNode.wrapperNode();
    var options = <parserCoreApi.Options>(Array.isArray(arg1) ? arg2 : arg1);
    setAttributeDefaults(api,options);
    return new Opt<RamlWrapper1.Api|RamlWrapper08.Api>(api);


}

/***
 * Load RAML synchronously. Detects RAML version and uses corresponding parser.
 * @param ramlPath Path to RAML: local file system path or Web URL
 * @param options Load options
 * @return Opt&lt;RAMLLanguageElement&gt;, where RAMLLanguageElement belongs to RAML 1.0 or RAML 0.8 model.
 ***/
export function loadRAML(ramlPath:string,arg1?:string[]|parserCoreApi.Options,arg2?:string[]|parserCoreApi.Options) : Opt<hl.BasicNode> {
    var hlNode = loadRAMLInternalHL(ramlPath, arg1, arg2);
    if(!hlNode){
        return Opt.empty<hl.BasicNode>();
    }
    var api = hlNode.wrapperNode();
    var options = <parserCoreApi.Options>(Array.isArray(arg1) ? arg2 : arg1);
    setAttributeDefaults(api,options);
    return new Opt<hl.BasicNode>(api);
}

/***
 * Load RAML synchronously. Detects RAML version and uses corresponding parser.
 * @param ramlPath Path to RAML: local file system path or Web URL
 * @param options Load options
 * @return Opt&lt;hl.IHighLevelNode&gt;
 ***/
export function loadRAMLHL(ramlPath:string,arg1?:string[]|parserCoreApi.Options,arg2?:string[]|parserCoreApi.Options) : Opt<hl.IHighLevelNode> {
    var hlNode = loadRAMLInternalHL(ramlPath, arg1, arg2);
    if(!hlNode){
        return Opt.empty<hl.IHighLevelNode>();
    }
    return new Opt<hl.IHighLevelNode>(hlNode);
}


function loadRAMLInternalHL(apiPath:string,arg1?:string[]|parserCoreApi.Options,arg2?:string[]|parserCoreApi.Options) : hl.IHighLevelNode {
    var gotArray = Array.isArray(arg1);
    var extensionsAndOverlays = <string[]>(gotArray ? arg1: null);
    var options = <parserCoreApi.Options>(gotArray ? arg2 : arg1);
    options = options || {};


    var project = getProject(apiPath,options);
    var pr=apiPath.indexOf("://");
    var unitName=(pr!=-1&&pr<6)?apiPath:path.basename(apiPath);
    var unit = project.unit(unitName);

    if (arg2 && !extensionsAndOverlays) {
        extensionsAndOverlays=null;
    }

    var api:hl.IHighLevelNode;
    if(unit){

        if (extensionsAndOverlays && extensionsAndOverlays.length > 0) {
            var extensionUnits = [];

            extensionsAndOverlays.forEach(currentPath =>{
                if (!currentPath || currentPath.trim().length == 0) {
                    throw new Error(messageRegistry.EXTENSIONS_AND_OVERLAYS_LEGAL_FILE_PATHS.message);
                }
            })

            extensionsAndOverlays.forEach(unitPath=>{
                extensionUnits.push(project.unit(unitPath, path.isAbsolute(unitPath)))
            })

            //calling to perform the checks, we do not actually need the api itself
            extensionUnits.forEach(extensionUnit=>toApi(extensionUnit, options))

            api = toApi(expanderLL.mergeAPIs(unit, extensionUnits, hlimpl.OverlayMergeMode.MERGE), options);
        } else {

            api = toApi(unit, options);
            (<hlimpl.ASTNodeImpl>api).setMergeMode(hlimpl.OverlayMergeMode.MERGE);
        }

    }

    if (!unit){
        throw new Error(linter.applyTemplate(messageRegistry.CAN_NOT_RESOLVE,{path:apiPath}));
    }

    if(options.rejectOnErrors && api && api.errors().filter(x=>!x.isWarning).length){
        throw toError(api);
    }
    return api;
}

/***
 * Load API asynchronously. Detects RAML version and uses corresponding parser.
 * @param apiPath Path to API: local file system path or Web URL
 * @param options Load options
 * @return Promise&lt;Api&gt;, where Api belongs to RAML 1.0 or RAML 0.8 model.
 ***/
export function loadApiAsync(apiPath:string,arg1?:string[]|parserCoreApi.Options,arg2?:string[]|parserCoreApi.Options):Promise<RamlWrapper1.Api|RamlWrapper08.Api>{
    var ramlPromise = loadRAMLAsync(apiPath,arg1,arg2);
    return ramlPromise.then(loadedRaml=>{
        // if (false) {
        //     //TODO check that loaded RAML is API
        //     return Promise.reject("Specified RAML is not API");
        // } else {
        return <RamlWrapper1.Api|RamlWrapper08.Api>loadedRaml;
        // }
    })
}

/***
 * Load API asynchronously. Detects RAML version and uses corresponding parser.
 * @param ramlPath Path to RAML: local file system path or Web URL
 * @param options Load options
 * @return Promise&lt;RAMLLanguageElement&gt;, where RAMLLanguageElement belongs to RAML 1.0 or RAML 0.8 model.
 ***/
export function loadRAMLAsync(ramlPath:string,arg1?:string[]|parserCoreApi.Options,arg2?:string[]|parserCoreApi.Options):Promise<hl.BasicNode>{

    return loadRAMLAsyncHL(ramlPath,arg1,arg2).then(x=>{

        if(!x){
            return null;
        }
        var gotArray = Array.isArray(arg1);
        var options = <parserCoreApi.Options>(gotArray ? arg2 : arg1);

        var node = x;
        while (node != null) {
            var wn = node.wrapperNode();
            setAttributeDefaults(wn,options);
            var master = node.getMaster();
            node = master && master !== node ? master.asElement() : null;
        }

        return x.wrapperNode();
    });
}
export function loadRAMLAsyncHL(ramlPath:string,arg1?:string[]|parserCoreApi.Options,arg2?:string[]|parserCoreApi.Options):Promise<hl.IHighLevelNode>{
    var gotArray = Array.isArray(arg1);
    var extensionsAndOverlays = <string[]>(gotArray ? arg1: null);
    var options = <parserCoreApi.Options>(gotArray ? arg2 : arg1);
    options = options || {};

    var project = getProject(ramlPath,options);
    var pr=ramlPath.indexOf("://");
    var unitName=(pr!=-1&&pr<6)?ramlPath:path.basename(ramlPath);

    if (arg2 && !extensionsAndOverlays) {
        extensionsAndOverlays=null;
    }

    if (!extensionsAndOverlays || extensionsAndOverlays.length == 0) {
        return fetchAndLoadApiAsyncHL(project, unitName, options).then(masterApi=>{
            (<hlimpl.ASTNodeImpl>masterApi).setMergeMode(hlimpl.OverlayMergeMode.MERGE);
            return masterApi;
        })
    } else {

        extensionsAndOverlays.forEach(currentPath =>{
            if (!currentPath || currentPath.trim().length == 0) {
                throw new Error(messageRegistry.EXTENSIONS_AND_OVERLAYS_LEGAL_FILE_PATHS.message);
            }
        })

        return fetchAndLoadApiAsyncHL(project, unitName, options).then(masterApi=>{
            var apiPromises = []

            extensionsAndOverlays.forEach(extensionUnitPath=>{
                apiPromises.push(fetchAndLoadApiAsyncHL(project, extensionUnitPath, options))
            });

            return Promise.all(apiPromises).then(apis=>{
                var overlayUnits = []
                apis.forEach(currentApi=>overlayUnits.push(currentApi.lowLevel().unit()))

                var result = expanderLL.mergeAPIs(masterApi.lowLevel().unit(), overlayUnits,
                    hlimpl.OverlayMergeMode.MERGE);
                return result;
            }).then(mergedHighLevel=>{
                return toApi(mergedHighLevel, options);
            })
        });
    }
}

/**
 * Gets AST node by runtime type, if runtime type matches any.
 * @param runtimeType
 */
export function getLanguageElementByRuntimeType(runtimeType : hl.ITypeDefinition) : parserCore.BasicNode {
    if (runtimeType == null) {
        return null;
    }

    var highLevelNode = runtimeType.getAdapter(ramlServices.RAMLService).getDeclaringNode();
    if (highLevelNode == null) {
        return null;
    }

    return highLevelNode.wrapperNode();
}

function fetchAndLoadApiAsync(project: jsyaml.Project, unitName : string, options: parserCoreApi.Options):Promise<hl.BasicNode> {
    return fetchAndLoadApiAsyncHL(project,unitName,options).then(x=>x.wrapperNode());
}

function fetchAndLoadApiAsyncHL(project: jsyaml.Project, unitName : string, options: parserCoreApi.Options):Promise<hl.IHighLevelNode>{
    var _unitName = unitName.replace(/\\/g,"/")
    return llimpl.fetchIncludesAndMasterAsync(project,_unitName).then(x=>{
        try {
            var api = toApi(x, options);
            if (options.rejectOnErrors && api && api.errors().filter(x=>!x.isWarning).length) {
                return Promise.reject<hl.IHighLevelNode>(toError(api));
            }
            return api;
        }
        catch(err){
            return Promise.reject<hl.IHighLevelNode>(err);
        }
    });
}

function getProject(apiPath:string,options?:parserCoreApi.Options):jsyaml.Project {

    options = options || {};
    var includeResolver = options.fsResolver;
    var httpResolver = options.httpResolver;
    var reusedNode = options.reusedNode;
    var project:jsyaml.Project;
    if(reusedNode){
        let reusedUnit = reusedNode.lowLevel().unit();
        project = <jsyaml.Project>reusedUnit.project();
        project.namespaceResolver().deleteUnitModel(reusedUnit.absolutePath());
        project.deleteUnit(path.basename(apiPath));
        if(includeResolver) {
            project.setFSResolver(includeResolver);
        }
        if(httpResolver){
            project.setHTTPResolver(httpResolver);
        }
    }
    else {
        var projectRoot = path.dirname(apiPath);
        project = new jsyaml.Project(projectRoot, includeResolver, httpResolver);
    }
    return project;
};

function toApi(unitOrHighlevel:ll.ICompilationUnit|hl.IHighLevelNode, options:parserCoreApi.Options,checkApisOverlays=false):hl.IHighLevelNode {
    options = options||{};
    if(!unitOrHighlevel){
        return null;
    }

    var unit : ll.ICompilationUnit = null;
    var highLevel : hl.IHighLevelNode = null;

    if ((<any>unitOrHighlevel).isRAMLUnit) {
        unit = <ll.ICompilationUnit>unitOrHighlevel;
    } else {
        highLevel = <hlimpl.ASTNodeImpl>unitOrHighlevel;
        unit = highLevel.lowLevel().unit();
    }

    var contents = unit.contents();

    var ramlFirstLine = hlimpl.ramlFirstLine(contents);
    if(!ramlFirstLine){
        throw new Error(messageRegistry.INVALID_FIRST_LINE.message);
    }

    var verStr = ramlFirstLine[1];
    var ramlFileType = ramlFirstLine[2];

    var typeName;
    var apiImpl;

    var ramlVersion;
    if (verStr == '0.8') {
        ramlVersion='RAML08';
    } else if (verStr == '1.0') {
        ramlVersion='RAML10';
    }

    if (!ramlVersion) {
        throw new Error(messageRegistry.UNKNOWN_RAML_VERSION.message);
    }
    if(ramlVersion=='RAML08'&&checkApisOverlays){
        throw new Error(messageRegistry.EXTENSIONS_AND_OVERLAYS_NOT_SUPPORTED_0_8.message);
    }

    //if (!ramlFileType || ramlFileType.trim() === "") {
    //    if (verStr=='0.8') {
    //        typeName = universeDef.Universe08.Api.name;
    //        apiImpl = RamlWrapper08.ApiImpl;
    //    } else if(verStr=='1.0'){
    //        typeName = universeDef.Universe10.Api.name;
    //        apiImpl = RamlWrapper1.ApiImpl;
    //    }
    //} else if (ramlFileType === "Overlay") {
    //    apiImpl = RamlWrapper1.OverlayImpl;
    //    typeName = universeDef.Universe10.Overlay.name;
    //} else if (ramlFileType === "Extension") {
    //    apiImpl = RamlWrapper1.ExtensionImpl;
    //    typeName = universeDef.Universe10.Extension.name;
    //}

    var universe = universeProvider(ramlVersion);
    var apiType = universe.type(typeName);

    if (!highLevel) {
        highLevel = <hl.IHighLevelNode>hlimpl.fromUnit(unit);
        if(options.reusedNode) {
            if(options.reusedNode.lowLevel().unit().absolutePath()==unit.absolutePath()) {
                if(checkReusability(<hlimpl.ASTNodeImpl>highLevel,
                        <hlimpl.ASTNodeImpl>options.reusedNode)) {
                    (<hlimpl.ASTNodeImpl>highLevel).setReusedNode(options.reusedNode);
                }
            }
        }
        //highLevel =
        //    new hlimpl.ASTNodeImpl(unit.ast(), null, <any>apiType, null)
    }
    //api = new apiImpl(highLevel);
    return highLevel;
};

export function toError(api:hl.IHighLevelNode):hl.ApiLoadingError{
    var error:any = new Error(messageRegistry.API_CONTAINS_ERROR.message);
    error.parserErrors = hlimpl.toParserErrors(api.errors(),api);
    return error;
}


export function loadApis1(projectRoot:string,cacheChildren:boolean = false,expandTraitsAndResourceTypes:boolean=true){

    var universe = universeProvider("RAML10");
    var apiType=universe.type(universeDef.Universe10.Api.name);

    var p=new jsyaml.Project(projectRoot);
    var result:RamlWrapper1.Api[] = [];
    p.units().forEach( x=> {
        var lowLevel = x.ast();
        if(cacheChildren){
            lowLevel = llimpl.toChildCachingNode (lowLevel);
        }
        var api:RamlWrapper1.Api = new RamlWrapper1Impl.ApiImpl(new hlimpl.ASTNodeImpl(lowLevel, null, <any>apiType, null));

        if(expandTraitsAndResourceTypes){
            api = expanderLL.expandTraitsAndResourceTypes(api);
        }
        result.push(api);
    });
    return result;
}

function checkReusability(hnode:hlimpl.ASTNodeImpl,rNode:hlimpl.ASTNodeImpl){
    if(!rNode) {
        return false;
    }
    var s1 = hnode.lowLevel().unit().contents();
    var s2 = rNode.lowLevel().unit().contents();
    var l = Math.min(s1.length,s2.length);
    var pos = -1;
    for(var i = 0 ; i < l ; i++){
        if(s1.charAt(i)!=s2.charAt(i)){
            pos = i;
            break;
        }
    }
    while(pos>0&&s1.charAt(pos).replace(/\s/,'')==''){
        pos--;
    }
    if(pos<0&&s1.length!=s2.length){
        pos = l;
    }
    var editedNode = search.deepFindNode(rNode,pos,pos+1);
    if(!editedNode){
        return true;
    }
    if(editedNode.lowLevel().unit().absolutePath() != hnode.lowLevel().unit().absolutePath()){
        return true;
    }
    var editedElement = editedNode.isElement() ? editedNode.asElement() : editedNode.parent();
    if(!editedElement){
        return true;
    }
    var pProp = editedElement.property();
    if(!pProp){
        return true;
    }
    if(universeHelpers.isAnnotationsProperty(pProp)){
        editedElement = editedElement.parent();
    }
    if(!editedElement){
        return true;
    }
    var p = editedElement;
    while(p){
        var pDef = p.definition();
        if(universeHelpers.isResourceTypeType(pDef)||universeHelpers.isTraitType(pDef)){
            return false;
        }
        var prop = p.property();
        if(!prop){
            return true;
        }
        if(universeHelpers.isTypeDeclarationDescendant(pDef)){
            if(universeHelpers.isTypesProperty(prop)||universeHelpers.isAnnotationTypesProperty(prop)){
                return false;
            }
        }
        var propRange = prop.range();
        if(universeHelpers.isResourceTypeRefType(propRange)||universeHelpers.isTraitRefType(propRange)){
            return false;
        }
        p = p.parent();
    }
    return true;
}

function setAttributeDefaults(api:parserCoreApi.BasicNode,options){
    options = options || {};
    if (options.attributeDefaults != null && api) {
        (<any>api).setAttributeDefaults(options.attributeDefaults);
    } else if (api) {
        (<any>api).setAttributeDefaults(true);
    }
}

export function optionsForContent(
    content:string,
    arg2?:parserCoreApi.Options,
    _filePath?:string):parserCoreApi.Options{

    let filePath = _filePath || virtualFilePath(arg2);
    let fsResolver = virtualFSResolver(filePath,content,arg2&&arg2.fsResolver);
    return {
        fsResolver:fsResolver,
        httpResolver:arg2?arg2.httpResolver:null,
        rejectOnErrors:arg2?arg2.rejectOnErrors:false,
        attributeDefaults:arg2?arg2.attributeDefaults:true
    }
}

function toOldStyleOptions(options:parserCoreApi.LoadOptions):parserCoreApi.Options{

    if(!options){
        return {};
    }
    return {
        fsResolver: options.fsResolver,
        httpResolver: options.httpResolver,
        rejectOnErrors: false,
        attributeDefaults: true
    };
}

export function loadOptionsForContent(
    content:string,
    arg2?:parserCoreApi.LoadOptions,
    _filePath?:string):parserCoreApi.LoadOptions{

    let filePath = _filePath || virtualFilePath(arg2);
    let fsResolver = virtualFSResolver(filePath,content,arg2&&arg2.fsResolver);
    let result:parserCoreApi.LoadOptions = {
        fsResolver: fsResolver
    };
    if(!arg2){
        return result;
    }
    for(let key of Object.keys(arg2)){
        if(key != "fsResolver"){
            result[key] = arg2[key];
        }
    }
    return result;
}

function consideredAsRamlContent(str:string):boolean{
    str = str && str.trim();
    if(!str){
        return true;
    }
    if(str.length<="#%RAML".length){
        return util.stringStartsWith("#%RAML",str);
    }
    else if(util.stringStartsWith(str,"#%RAML")){
        return true;
    }
    return str.indexOf("\n")>=0;
}

function toNewFormatSerializeOptions(options: parserCoreApi.LoadOptions) {
    options = options || {};
    return {
        rootNodeDetails: true,
        attributeDefaults: true,
        serializeMetadata: options.serializeMetadata || false,
        expandExpressions: options.expandExpressions,
        typeReferences: options.typeReferences,
        expandTypes: options.expandTypes,
        typeExpansionRecursionDepth: options.typeExpansionRecursionDepth,
        sourceMap: options.sourceMap
    };
}

export function virtualFSResolver(
    filePath: string,
    content: string,
    originalResolver: resolversApi.FSResolver):resolversApi.FSResolver {

    if(filePath!=null){
        filePath = filePath.replace(/\\/g,"/");
    }
    return {
        content(pathStr: string): string {
            if (pathStr === filePath) {
                return content;
            }
            if (originalResolver) {
                return originalResolver.content(pathStr);
            }
        },

        contentAsync(pathStr: string): Promise<string> {
            if (pathStr === filePath) {
                return Promise.resolve<string>(content);
            }
            if (originalResolver) {
                return originalResolver.contentAsync(pathStr);
            }
        }
    };
}

export function virtualFilePath(opt:parserCoreApi.Options|parserCoreApi.LoadOptions):string{
    let filePath = (opt && opt.filePath)||path.resolve("/#local.raml");
    return filePath.replace(/\\/g,"/");
}