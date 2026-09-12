
(function(){
"use strict";

/* =========================================================
   CONFIG
========================================================= */

var MAX_PDF_MB=20;
var MAX_IMAGE_MB=15;
var MAX_AUDIO_MB=25;
var MAX_PDF_PAGES_FOR_JPG=60;

/* =========================================================
   ON-DEMAND LIBRARY LOADING
   Heavy third-party libraries are only fetched the first time a
   tool that actually needs them is opened, instead of blocking
   every homepage visit with ~1MB+ of unused JavaScript.
========================================================= */

var LIBRARY_URLS={
pdfLib:"https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js",
pdfjsLib:"https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
qrcode:"https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js",
jszip:"https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
lamejs:"https://cdn.jsdelivr.net/npm/lamejs@1.2.0/lame.min.js"
};
var _libraryPromises={};

function loadLibrary(key){
if(_libraryPromises[key])return _libraryPromises[key];
_libraryPromises[key]=new Promise(function(resolve,reject){
var script=document.createElement("script");
script.src=LIBRARY_URLS[key];
script.onload=function(){
if(key==="pdfjsLib"&&window.pdfjsLib){
window.pdfjsLib.GlobalWorkerOptions.workerSrc=
"https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
}
resolve();
};
script.onerror=function(){
delete _libraryPromises[key];
reject(new Error("A required component could not be loaded. Check your connection and try again."));
};
document.head.appendChild(script);
});
return _libraryPromises[key];
}
function loadLibraries(keys){
return Promise.all(keys.map(loadLibrary));
}

/* =========================================================
   HELPERS
========================================================= */

function escapeHTML(v){
return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}
function escapeXML(v){
return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function formatFileSize(bytes){
if(bytes===0)return "0 Bytes";
var units=["Bytes","KB","MB","GB"];
var index=Math.floor(Math.log(bytes)/Math.log(1024));
return (bytes/Math.pow(1024,index)).toFixed(2)+" "+units[index];
}
function baseNameWithoutExt(filename){
var name=String(filename||"File").replace(/\.[^/.]+$/,"");
name=name.trim();
return name?name:"File";
}
/* Builds the mandatory ToolTexx output filename:
   "<original base name> ToolTexx converted.<ext>"
   Never duplicates the phrase if it is already present. */
function toolTexxOutputName(originalName,newExt){
var base=baseNameWithoutExt(originalName);
var marker="ToolTexx converted";
if(base.indexOf(marker)===-1){
base=base+" "+marker;
}
return base+"."+newExt;
}
function createDownloadLink(blob,filename,label){
var url=URL.createObjectURL(blob);
var link=document.createElement("a");
link.href=url;
link.download=filename;
link.className="download-link";
link.textContent=(label||"Download ")+filename;
return link;
}
/* Revoke any blob: object URLs held by download links currently in a
   result area before clearing it out, so re-converting a file (or
   switching files) in the same session doesn't leak memory. */
function clearResultArea(container){
if(!container)return;
container.querySelectorAll("a[href^='blob:']").forEach(function(a){
URL.revokeObjectURL(a.href);
});
container.innerHTML="";
}
function setStatus(el,message,type){
if(!el)return;
el.textContent=message;
el.className="status-msg"+(type?" "+type:"");
}

/* =========================================================
   TOOL INFO
========================================================= */

var TOOL_INFO={
"pdf-to-word":{title:"PDF to Word",icon:"PDF",cls:"tag-pdf",desc:"Converts your PDF to a Word (.docx) file, keeping tables, bold/italic text, headings, and images where possible."},
"merge-pdf":{title:"Merge PDF",icon:"PDF",cls:"tag-pdf",desc:"Combine multiple PDF files into one document, in the order you add them."},
"split-pdf":{title:"Split PDF",icon:"PDF",cls:"tag-pdf",desc:"Extract a page range from your PDF into a new file."},
"compress-pdf":{title:"Compress PDF",icon:"PDF",cls:"tag-pdf",desc:"Rebuilds your PDF to reduce structural overhead. Savings are modest since embedded images are not recompressed."},
"pdf-to-jpg":{title:"PDF to JPG",icon:"PDF",cls:"tag-pdf",desc:"Convert each page of your PDF into a downloadable JPG image."},
"jpg-to-pdf":{title:"JPG to PDF",icon:"PDF",cls:"tag-pdf",desc:"Combine one or more images into a single PDF document."},
"image-compressor":{title:"Image Compressor",icon:"IMG",cls:"tag-img",desc:"Reduce image file size while keeping useful quality."},
"image-resizer":{title:"Image Resizer",icon:"IMG",cls:"tag-img",desc:"Resize an image to a specific width, keeping its aspect ratio."},
"image-cropper":{title:"Image Cropper",icon:"IMG",cls:"tag-img",desc:"Drag the box to select the area you want to keep, then crop."},
"image-converter":{title:"Image Converter",icon:"IMG",cls:"tag-img",desc:"Convert an image between PNG, JPG and WebP formats."},
"music-converter":{title:"Music Converter",icon:"MP3",cls:"tag-audio",desc:"Convert an audio file to MP3 or WAV, right in your browser."},
"music-compressor":{title:"Music Compressor",icon:"MP3",cls:"tag-audio",desc:"Re-encode audio at a lower bitrate to shrink the file size."},
"word-counter":{title:"Word Counter",icon:"TXT",cls:"tag-util",desc:"Count words, characters and lines in your text, live."},
"case-converter":{title:"Case Converter",icon:"Aa",cls:"tag-util",desc:"Convert text to UPPERCASE, lowercase, Title Case or Sentence case."},
"qr-generator":{title:"QR Generator",icon:"QR",cls:"tag-util",desc:"Generate a QR code from any text, link or information."},
"password-generator":{title:"Password Generator",icon:"KEY",cls:"tag-util",desc:"Generate a strong, random password with custom options."},
"json-formatter":{title:"JSON Formatter",icon:"{ }",cls:"tag-util",desc:"Pretty-print or minify JSON, with validation."},
"base64-encoder":{title:"Base64 Encoder",icon:"64",cls:"tag-util",desc:"Encode text to Base64, or decode Base64 back to text."},
"unit-converter":{title:"Unit Converter",icon:"&#8596;",cls:"tag-util",desc:"Convert between units of length, weight and temperature."},
"calculator":{title:"Calculator",icon:"+",cls:"tag-util",desc:"A simple calculator for everyday arithmetic."}
};

/* =========================================================
   MODAL + MENU CONTROLS
========================================================= */

var modalBackdrop=document.getElementById("modalBackdrop");
var modalDialog=document.querySelector("#modalBackdrop .modal");
var modalIcon=document.getElementById("modalIcon");
var modalTitle=document.getElementById("modalTitle");
var modalDesc=document.getElementById("modalDesc");
var modalCloseBtn=document.getElementById("modalCloseBtn");
var workspace=document.getElementById("toolWorkspace");
var menuOverlay=document.getElementById("menuOverlay");
var menuSheet=document.querySelector("#menuOverlay .menu-sheet");
var menuOpenBtn=document.getElementById("menuOpenBtn");
var allToolsBtn=document.getElementById("allToolsBtn");
var menuCloseBtn=document.getElementById("menuCloseBtn");

var lastFocusedEl=null;

function getFocusable(container){
return Array.prototype.slice.call(
container.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')
).filter(function(el){return el.offsetParent!==null;});
}

function trapFocus(e,container){
if(e.key!=="Tab")return;
var focusable=getFocusable(container);
if(!focusable.length)return;
var first=focusable[0];
var last=focusable[focusable.length-1];
if(e.shiftKey&&document.activeElement===first){
e.preventDefault();last.focus();
}else if(!e.shiftKey&&document.activeElement===last){
e.preventDefault();first.focus();
}
}

function openTool(key){
var info=TOOL_INFO[key];
if(!info)return;

lastFocusedEl=document.activeElement;

modalIcon.innerHTML=info.icon;
modalIcon.className="modal-icon "+info.cls;
modalTitle.textContent=info.title;
modalDesc.textContent=info.desc;
workspace.innerHTML="";

menuOverlay.classList.remove("open");
menuOverlay.setAttribute("aria-hidden","true");
menuOpenBtn.setAttribute("aria-expanded","false");
if(allToolsBtn)allToolsBtn.setAttribute("aria-expanded","false");
document.body.style.overflow="hidden";
modalBackdrop.classList.add("open");
modalBackdrop.setAttribute("aria-hidden","false");

setupWorkspace(key);
modalCloseBtn.focus();
}

function closeModal(){
if(!modalBackdrop.classList.contains("open"))return;
modalBackdrop.classList.remove("open");
modalBackdrop.setAttribute("aria-hidden","true");
document.body.style.overflow="";
if(lastFocusedEl&&typeof lastFocusedEl.focus==="function"){
lastFocusedEl.focus();
}
}

function openMenu(triggerBtn){
lastFocusedEl=triggerBtn||document.activeElement;
menuOverlay.classList.add("open");
menuOverlay.setAttribute("aria-hidden","false");
menuOpenBtn.setAttribute("aria-expanded","true");
if(allToolsBtn)allToolsBtn.setAttribute("aria-expanded","true");
menuCloseBtn.focus();
}

function closeMenu(){
if(!menuOverlay.classList.contains("open"))return;
menuOverlay.classList.remove("open");
menuOverlay.setAttribute("aria-hidden","true");
menuOpenBtn.setAttribute("aria-expanded","false");
if(allToolsBtn)allToolsBtn.setAttribute("aria-expanded","false");
if(lastFocusedEl&&typeof lastFocusedEl.focus==="function"){
lastFocusedEl.focus();
}
}

modalCloseBtn.addEventListener("click",closeModal);
modalBackdrop.addEventListener("click",function(e){
if(e.target===modalBackdrop)closeModal();
});
modalDialog.addEventListener("keydown",function(e){
trapFocus(e,modalDialog);
});
menuSheet.addEventListener("keydown",function(e){
trapFocus(e,menuOverlay);
});
document.addEventListener("keydown",function(e){
if(e.key==="Escape"){closeModal();closeMenu();}
});

menuOpenBtn.addEventListener("click",function(){openMenu(menuOpenBtn);});
if(allToolsBtn)allToolsBtn.addEventListener("click",function(){openMenu(allToolsBtn);});
menuCloseBtn.addEventListener("click",closeMenu);
menuOverlay.addEventListener("click",function(e){
if(e.target===menuOverlay)closeMenu();
});

document.querySelectorAll(".icon-tile").forEach(function(btn){
btn.addEventListener("click",function(e){
/* Real crawlable href for search engines / no-JS visitors; when JS is
   available we open the tool in-place instead of navigating away. */
e.preventDefault();
openTool(this.dataset.key);
});
});
document.querySelectorAll(".menu-row").forEach(function(btn){
btn.addEventListener("click",function(e){
e.preventDefault();
openTool(this.dataset.key);
});
});


/* =========================================================
   WORKSPACE DISPATCH
========================================================= */

function setupWorkspace(key){
if(FILE_TOOLS[key]){
buildFileWorkspace(FILE_TOOLS[key]);
}else if(key==="image-compressor"){
buildSmartImageCompressor(workspace);
}else if(key==="image-resizer"){
buildImageSizeWorkspace(key);
}else if(key==="image-cropper"){
buildCropWorkspace();
}else if(key==="music-converter"){
buildMusicConverterWorkspace();
}else if(key==="music-compressor"){
buildMusicCompressorWorkspace();
}else if(key==="word-counter"){
buildWordCounterWorkspace();
}else if(key==="case-converter"){
buildCaseConverterWorkspace();
}else if(key==="json-formatter"){
buildJsonFormatterWorkspace();
}else if(key==="base64-encoder"){
buildBase64Workspace();
}else if(key==="qr-generator"){
buildQrWorkspace();
}else if(key==="password-generator"){
buildPasswordWorkspace();
}else if(key==="unit-converter"){
buildUnitWorkspace();
}else if(key==="calculator"){
buildCalculatorWorkspace();
}else{
workspace.innerHTML="<p>This tool is not available.</p>";
}
}

/* =========================================================
   GENERIC FILE WORKSPACE (PDF tools)
========================================================= */

var FILE_TOOLS={

"pdf-to-word":{accept:".pdf,application/pdf",multiple:false,hint:"Maximum file size: "+MAX_PDF_MB+"MB",buttonLabel:"Convert to Word",kind:"pdf",deps:["pdfjsLib","jszip"],onProcess:handlePdfToWord},

"merge-pdf":{accept:".pdf,application/pdf",multiple:true,hint:"Select two or more PDF files, max "+MAX_PDF_MB+"MB each",buttonLabel:"Merge PDFs",kind:"pdf",deps:["pdfLib"],onProcess:handleMergePdf},

"split-pdf":{accept:".pdf,application/pdf",multiple:false,hint:"Maximum file size: "+MAX_PDF_MB+"MB",buttonLabel:"Split PDF",kind:"pdf",deps:["pdfLib"],
extraFields:'<div class="field-row"><label>From Page</label><input type="number" id="fromPage" min="1" value="1"></div><div class="field-row"><label>To Page</label><input type="number" id="toPage" min="1" value="1"></div>',
onProcess:handleSplitPdf},

"compress-pdf":{accept:".pdf,application/pdf",multiple:false,hint:"Maximum file size: "+MAX_PDF_MB+"MB",buttonLabel:"Optimize PDF",kind:"pdf",deps:["pdfLib"],onProcess:handleCompressPdf},

"pdf-to-jpg":{accept:".pdf,application/pdf",multiple:false,hint:"Maximum "+MAX_PDF_MB+"MB, up to "+MAX_PDF_PAGES_FOR_JPG+" pages",buttonLabel:"Convert Pages",kind:"pdf",deps:["pdfjsLib"],onProcess:handlePdfToJpg},

"jpg-to-pdf":{accept:"image/jpeg,image/jpg,image/png,.jpg,.jpeg,.png",multiple:true,hint:"Select one or more JPG, JPEG or PNG images, max "+MAX_IMAGE_MB+"MB each",buttonLabel:"Create PDF",kind:"image",deps:["pdfLib"],onProcess:handleJpgToPdf},

"image-converter":{accept:"image/*",multiple:false,hint:"Maximum file size: "+MAX_IMAGE_MB+"MB",buttonLabel:"Convert Image",kind:"image",
extraFields:'<div class="field-row"><label>Convert To</label><select id="targetFormat"><option value="image/png">PNG</option><option value="image/jpeg">JPG</option><option value="image/webp">WebP</option></select></div>',
onProcess:handleImageConverter}

};

function fileWorkspaceTemplate(cfg){
return ''+
'<div class="field-row" id="extraFields" style="display:'+(cfg.extraFields?'flex':'none')+'">'+(cfg.extraFields||"")+'</div>'+
'<div class="upload-zone" id="uploadZone">'+
'<label class="choose-file" for="fileInput">Select File'+(cfg.multiple?'s':'')+'</label>'+
'<input type="file" id="fileInput" accept="'+cfg.accept+'"'+(cfg.multiple?' multiple':'')+' hidden>'+
'<span class="hint-text">'+escapeHTML(cfg.hint||"")+'</span>'+
'</div>'+
'<div id="selectedFile" class="selected-file"></div>'+
'<button class="process-button" id="processButton">'+escapeHTML(cfg.buttonLabel||"Start Processing")+'</button>'+
'<div id="toolStatus" class="status-msg" role="status" aria-live="polite"></div>'+
'<div id="resultArea" class="result-area"></div>';
}

function buildFileWorkspace(cfg){
workspace.innerHTML=fileWorkspaceTemplate(cfg);

var uploadZone=document.getElementById("uploadZone");
var fileInput=document.getElementById("fileInput");
var selectedFile=document.getElementById("selectedFile");
var processButton=document.getElementById("processButton");
var statusEl=document.getElementById("toolStatus");
var resultArea=document.getElementById("resultArea");

var currentFiles=[];

function showFiles(fileList){
currentFiles=Array.prototype.slice.call(fileList);
if(!currentFiles.length){
selectedFile.classList.remove("show");
selectedFile.innerHTML="";
return;
}
if(currentFiles.length===1){
var f=currentFiles[0];
selectedFile.innerHTML="<strong>"+escapeHTML(f.name)+"</strong><br>"+formatFileSize(f.size);
}else{
var html="<strong>"+currentFiles.length+" files selected</strong>";
selectedFile.innerHTML=html;
}
selectedFile.classList.add("show");
setStatus(statusEl,"","");
clearResultArea(resultArea);
}

fileInput.addEventListener("change",function(){showFiles(this.files);});
uploadZone.addEventListener("dragover",function(e){e.preventDefault();});
uploadZone.addEventListener("drop",function(e){
e.preventDefault();
if(e.dataTransfer.files.length){
fileInput.files=e.dataTransfer.files;
showFiles(e.dataTransfer.files);
}
});

processButton.addEventListener("click",function(){
if(!currentFiles.length){
setStatus(statusEl,cfg.multiple?"Please select files first.":"Please select a file first.","error");
return;
}
var maxMB=cfg.kind==="image"?MAX_IMAGE_MB:MAX_PDF_MB;
for(var i=0;i<currentFiles.length;i++){
if(currentFiles[i].size>maxMB*1024*1024){
setStatus(statusEl,"\""+currentFiles[i].name+"\" is larger than "+maxMB+"MB.","error");
return;
}
}
processButton.disabled=true;
setStatus(statusEl,cfg.deps&&cfg.deps.length?"Loading, please wait...":"Processing...","");
clearResultArea(resultArea);

Promise.resolve()
.then(function(){return cfg.deps&&cfg.deps.length?loadLibraries(cfg.deps):null;})
.then(function(){setStatus(statusEl,"Processing...","");return cfg.onProcess(currentFiles,statusEl,resultArea);})
.then(function(){processButton.disabled=false;})
.catch(function(error){
setStatus(statusEl,"Failed: "+(error&&error.message?error.message:String(error)),"error");
processButton.disabled=false;
});
});
}


/* =========================================================
   PDF HANDLERS
========================================================= */

function handleMergePdf(files,statusEl,resultArea){
if(files.length<2){throw new Error("Please select at least two PDF files.");}
var outputName=toolTexxOutputName(files[0].name,"pdf");
return PDFLib.PDFDocument.create().then(function(mergedPdf){
var chain=Promise.resolve();
files.forEach(function(file){
chain=chain.then(function(){
if(!file.name.toLowerCase().endsWith(".pdf")){
throw new Error("All selected files must be PDF files.");
}
return file.arrayBuffer().then(function(bytes){
return PDFLib.PDFDocument.load(bytes);
}).then(function(pdf){
return mergedPdf.copyPages(pdf,pdf.getPageIndices());
}).then(function(pages){
pages.forEach(function(page){mergedPdf.addPage(page);});
});
});
});
return chain.then(function(){return mergedPdf.save();});
}).then(function(output){
var blob=new Blob([output],{type:"application/pdf"});
setStatus(statusEl,"PDFs merged successfully.","success");
resultArea.appendChild(createDownloadLink(blob,outputName));
});
}

function handleSplitPdf(files,statusEl,resultArea){
var file=files[0];
var fromPage=parseInt(document.getElementById("fromPage").value,10);
var toPage=parseInt(document.getElementById("toPage").value,10);
return file.arrayBuffer().then(function(bytes){
return PDFLib.PDFDocument.load(bytes);
}).then(function(sourcePdf){
var totalPages=sourcePdf.getPageCount();
if(!fromPage||!toPage||fromPage<1||toPage>totalPages||fromPage>toPage){
throw new Error("Enter a valid page range. This PDF has "+totalPages+" pages.");
}
var indices=[];
for(var p=fromPage-1;p<=toPage-1;p++){indices.push(p);}
return PDFLib.PDFDocument.create().then(function(newPdf){
return newPdf.copyPages(sourcePdf,indices).then(function(pages){
pages.forEach(function(page){newPdf.addPage(page);});
return newPdf.save();
});
});
}).then(function(output){
var blob=new Blob([output],{type:"application/pdf"});
setStatus(statusEl,"Pages extracted successfully.","success");
resultArea.appendChild(createDownloadLink(blob,toolTexxOutputName(file.name,"pdf")));
});
}

function handleCompressPdf(files,statusEl,resultArea){
var file=files[0];
return file.arrayBuffer().then(function(bytes){
return PDFLib.PDFDocument.load(bytes);
}).then(function(pdf){
return pdf.save({useObjectStreams:true,addDefaultPage:false});
}).then(function(output){
var blob=new Blob([output],{type:"application/pdf"});
setStatus(statusEl,"PDF optimized successfully.","success");
resultArea.appendChild(createDownloadLink(blob,toolTexxOutputName(file.name,"pdf")));
});
}

function isLikelyPdfFile(bytes){
/* Real PDFs start with the "%PDF-" signature. Checking this up front
   gives a clear, immediate message instead of an opaque pdf.js parser
   error for a renamed .txt/.jpg or other non-PDF file. */
var header=new Uint8Array(bytes.slice(0,5));
var sig=String.fromCharCode.apply(null,header);
return sig==="%PDF-";
}

function handlePdfToJpg(files,statusEl,resultArea){
var file=files[0];
var baseOutputName=toolTexxOutputName(file.name,"jpg").replace(/\.jpg$/,"");
if(!window.pdfjsLib){throw new Error("PDF library is unavailable. Please refresh the page.");}
return file.arrayBuffer().then(function(bytes){
if(!isLikelyPdfFile(bytes)){
throw new Error("This file doesn't look like a valid PDF.");
}
return window.pdfjsLib.getDocument({data:bytes}).promise.catch(function(){
throw new Error("This PDF could not be opened. It may be corrupted or password-protected.");
});
}).then(function(pdf){
if(pdf.numPages<1){
throw new Error("This PDF has no pages to convert.");
}
if(pdf.numPages>MAX_PDF_PAGES_FOR_JPG){
throw new Error("This PDF has "+pdf.numPages+" pages. Please use a file with "+MAX_PDF_PAGES_FOR_JPG+" pages or fewer.");
}
var chain=Promise.resolve();
var successCount=0;
var failedPages=[];
for(var pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
(function(pageNumber){
chain=chain.then(function(){
/* A single page's render/encode failure should not abort the
   rest of the batch -- catch it here, note it, and move on. */
return renderPdfPageToJpegBlob(pdf,pageNumber).then(function(blob){
if(blob){
successCount++;
resultArea.appendChild(createDownloadLink(blob,baseOutputName+" page "+pageNumber+".jpg"));
}else{
failedPages.push(pageNumber);
}
}).catch(function(){
failedPages.push(pageNumber);
});
});
})(pageNumber);
}
return chain.then(function(){
if(successCount===0){
throw new Error("None of the "+pdf.numPages+" page(s) could be converted.");
}
if(failedPages.length>0){
setStatus(statusEl,successCount+" of "+pdf.numPages+" page(s) converted. Page(s) "+failedPages.join(", ")+" failed and were skipped.","error");
}else{
setStatus(statusEl,successCount+" page(s) converted successfully.","success");
}
});
});
}

function renderPdfPageToJpegBlob(pdf,pageNumber){
return pdf.getPage(pageNumber).then(function(page){
var viewport=page.getViewport({scale:1.8});
var canvas=document.createElement("canvas");
var context=canvas.getContext("2d");
if(!context){throw new Error("Canvas is unavailable for rendering.");}
canvas.width=viewport.width;canvas.height=viewport.height;
return page.render({canvasContext:context,viewport:viewport}).promise.then(function(){
return new Promise(function(resolve){canvas.toBlob(resolve,"image/jpeg",0.92);});
}).finally(function(){
/* Release this page's cached rendering resources right away
   instead of waiting for the whole batch (and garbage
   collection) to free them -- keeps memory bounded on
   long/multi-page PDFs. */
if(typeof page.cleanup==="function"){page.cleanup();}
});
});
}

function isPngImageFile(file){
var name=(file.name||"").toLowerCase();
var type=(file.type||"").toLowerCase();
if(type==="image/png")return true;
if(name.endsWith(".png"))return true;
return false;
}

function isJpgImageFile(file){
var name=(file.name||"").toLowerCase();
var type=(file.type||"").toLowerCase();
if(type==="image/jpeg"||type==="image/jpg")return true;
/* Some browsers/OSes report an empty or generic file.type (especially
   over drag-and-drop), so fall back to checking the extension too. */
if(name.endsWith(".jpg")||name.endsWith(".jpeg"))return true;
return false;
}

function isJpgOrPngImage(file){
return isPngImageFile(file)||isJpgImageFile(file);
}

function handleJpgToPdf(files,statusEl,resultArea){
for(var i=0;i<files.length;i++){
if(!isJpgOrPngImage(files[i])){
throw new Error("Please select a JPG, JPEG, or PNG image.");
}
}
var outputName=toolTexxOutputName(files[0].name,"pdf");
return PDFLib.PDFDocument.create().then(function(pdf){
var chain=Promise.resolve();
files.forEach(function(file){
chain=chain.then(function(){
return file.arrayBuffer().then(function(bytes){
return isPngImageFile(file)?pdf.embedPng(bytes):pdf.embedJpg(bytes);
}).catch(function(err){
throw new Error("\""+file.name+"\" could not be read as a valid JPG/PNG image.");
}).then(function(image){
var page=pdf.addPage([image.width,image.height]);
page.drawImage(image,{x:0,y:0,width:image.width,height:image.height});
});
});
});
return chain.then(function(){return pdf.save();});
}).then(function(output){
var blob=new Blob([output],{type:"application/pdf"});
setStatus(statusEl,"PDF created successfully.","success");
resultArea.appendChild(createDownloadLink(blob,outputName));
});
}

/* =========================================================
   PDF TO WORD (shared core: used by both modal + featured box)

   Reconstructs, on a best-effort basis:
   - simple table/grid layouts (timesheets, invoices, forms) as
     real Word tables
   - bold / italic emphasis and heading-sized text, using the
     actual embedded font's bold/italic flags and the text's
     point size relative to the document's typical body size
   - two genuinely side-by-side text columns (e.g. a resume or
     newsletter) as two sequential paragraph blocks in correct
     reading order, instead of interleaving them line-by-line
   - images that appear in the PDF, placed at their approximate
     position in the reading order

   This is a heuristic based on the x/y position, font, and size
   of each text fragment reported by pdf.js, plus the PDF's
   drawing operator list for images -- it will not be pixel
   perfect for every PDF, but it keeps far more of the original
   structure than plain text extraction.
========================================================= */

var PDF_COLUMN_GAP_PT=9;      /* gap that splits two fields within one row */
var PDF_COLUMN_MERGE_PT=16;   /* gap under which two field start-x positions are treated as the same column */
var PDF_MAX_TABLE_COLUMNS=14; /* safety cap so a noisy page can't explode into huge tables */
var PDF_HEADING_SIZE_RATIO=1.15; /* text this many times the body size counts as a heading */

function buildDocxRunXml(run,forceHeading){
var bold=forceHeading||run.bold;
var props="";
if(bold)props+="<w:b/>";
if(run.italic)props+="<w:i/>";
var halfPoints=Math.max(12,Math.min(72,Math.round((run.fontSize||10)*2)));
props+='<w:sz w:val="'+halfPoints+'"/>';
var text=escapeXML(run.text);
return '<w:r>'+(props?'<w:rPr>'+props+'</w:rPr>':'')+'<w:t xml:space="preserve">'+text+'</w:t></w:r>';
}

function buildDocxTableXml(rows){
var colCount=rows.reduce(function(max,r){return Math.max(max,r.length);},1);
var gridCols=new Array(colCount).fill(0).map(function(){return '<w:gridCol/>';}).join("");
var borders=
'<w:tblBorders>'+
'<w:top w:val="single" w:sz="4" w:space="0" w:color="B0B0B0"/>'+
'<w:left w:val="single" w:sz="4" w:space="0" w:color="B0B0B0"/>'+
'<w:bottom w:val="single" w:sz="4" w:space="0" w:color="B0B0B0"/>'+
'<w:right w:val="single" w:sz="4" w:space="0" w:color="B0B0B0"/>'+
'<w:insideH w:val="single" w:sz="4" w:space="0" w:color="B0B0B0"/>'+
'<w:insideV w:val="single" w:sz="4" w:space="0" w:color="B0B0B0"/>'+
'</w:tblBorders>';
var rowsXml=rows.map(function(row){
var cellsXml=[];
for(var i=0;i<colCount;i++){
var cell=row[i];
var runsXml;
if(cell&&cell.runs&&cell.runs.length){
runsXml=cell.runs.map(function(r){return buildDocxRunXml({text:r.text,bold:r.bold,italic:r.italic,fontSize:9},false);}).join("");
}else{
runsXml='<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve"></w:t></w:r>';
}
cellsXml.push(
'<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/><w:tcMar>'+
'<w:top w:w="60" w:type="dxa"/><w:left w:w="80" w:type="dxa"/>'+
'<w:bottom w:w="60" w:type="dxa"/><w:right w:w="80" w:type="dxa"/>'+
'</w:tcMar></w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>'+runsXml+'</w:p></w:tc>'
);
}
return '<w:tr>'+cellsXml.join("")+'</w:tr>';
}).join("");
return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>'+borders+'</w:tblPr>'+
'<w:tblGrid>'+gridCols+'</w:tblGrid>'+rowsXml+'</w:tbl>'+
'<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';
}

function buildDocxImageXml(relId,widthEmu,heightEmu,docPrId){
return '<w:p><w:r><w:drawing>'+
'<wp:inline distT="0" distB="0" distL="0" distR="0">'+
'<wp:extent cx="'+Math.round(widthEmu)+'" cy="'+Math.round(heightEmu)+'"/>'+
'<wp:docPr id="'+docPrId+'" name="Picture '+docPrId+'"/>'+
'<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'+
'<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'+
'<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'+
'<pic:nvPicPr><pic:cNvPr id="'+docPrId+'" name="Picture '+docPrId+'"/><pic:cNvPicPr/></pic:nvPicPr>'+
'<pic:blipFill><a:blip r:embed="'+relId+'"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'+
'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+Math.round(widthEmu)+'" cy="'+Math.round(heightEmu)+'"/></a:xfrm>'+
'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'+
'</pic:pic></a:graphicData></a:graphic>'+
'</wp:inline></w:drawing></w:r></w:p>';
}

function buildDocxFromBlocks(blocks){
var zip=new JSZip();

/* Collect image blocks up front so we can register them as media
   parts + relationships; everything else stays plain OOXML text. */
var imageBlocks=blocks.filter(function(b){return b.type==="image";});

var relEntries=['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'];
var docRelEntries=[];
var contentTypeOverrides=[];
var usedExtensions={};

imageBlocks.forEach(function(img,i){
var relId="rIdImg"+(i+1);
img._relId=relId;
var ext=img.mimeType==="image/jpeg"?"jpg":"png";
img._partName="media/image"+(i+1)+"."+ext;
docRelEntries.push('<Relationship Id="'+relId+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="'+img._partName+'"/>');
if(!usedExtensions[ext]){
usedExtensions[ext]=true;
contentTypeOverrides.push('<Default Extension="'+ext+'" ContentType="image/'+ext+'"/>');
}
zip.file("word/"+img._partName,img.blob);
});

zip.file("[Content_Types].xml",
'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
'<Default Extension="xml" ContentType="application/xml"/>'+
contentTypeOverrides.join("")+
'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'+
'</Types>');
zip.file("_rels/.rels",
'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
relEntries.join("")+
'</Relationships>');
if(docRelEntries.length){
zip.file("word/_rels/document.xml.rels",
'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
docRelEntries.join("")+
'</Relationships>');
}

var imageCounter=0;
var bodyXml=blocks.map(function(block){
if(block.type==="table"){
return buildDocxTableXml(block.rows);
}
if(block.type==="pagebreak"){
return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}
if(block.type==="image"){
imageCounter++;
/* EMU = 1/914400 inch; our widths/heights are in PDF points (1/72 inch). */
var widthEmu=(block.width||100)*12700;
var heightEmu=(block.height||100)*12700;
return buildDocxImageXml(block._relId,widthEmu,heightEmu,imageCounter);
}
/* paragraph */
var runs=block.runs&&block.runs.length?block.runs:[{text:block.text||"",bold:false,italic:false,fontSize:10}];
var isHeading=block.isHeading;
var runsXml=runs.map(function(r){return buildDocxRunXml(r,isHeading);}).join("");
return '<w:p>'+runsXml+'</w:p>';
}).join("");

if(!bodyXml){bodyXml='<w:p/>';}

zip.file("word/document.xml",
'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '+
'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '+
'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '+
'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" '+
'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
'<w:body>'+bodyXml+'<w:sectPr/></w:body>'+
'</w:document>');
return zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
}

/* PDF matrices compose as: result = local ∘ existing (local applied
   first, in the existing coordinate system). Used to track the
   current transformation matrix while walking a page's operator
   list, so each image's real on-page position can be recovered. */
function multiplyPdfMatrices(m1,m2){
return [
m1[0]*m2[0]+m1[1]*m2[2],
m1[0]*m2[1]+m1[1]*m2[3],
m1[2]*m2[0]+m1[3]*m2[2],
m1[2]*m2[1]+m1[3]*m2[3],
m1[4]*m2[0]+m1[5]*m2[2]+m2[4],
m1[4]*m2[1]+m1[5]*m2[3]+m2[5]
];
}

/* Walks a page's operator list to find every drawn image and its
   real position/size on the page (via the CTM at draw time). Only
   called for pages that actually contain an image paint operator. */
function extractPageImages(page,opList){
var OPS=window.pdfjsLib.OPS;
var stack=[[1,0,0,1,0,0]];
var images=[];
for(var i=0;i<opList.fnArray.length;i++){
var fn=opList.fnArray[i];
var args=opList.argsArray[i];
if(fn===OPS.save){
stack.push(stack[stack.length-1].slice());
}else if(fn===OPS.restore){
if(stack.length>1)stack.pop();
}else if(fn===OPS.transform){
var top=stack[stack.length-1];
stack[stack.length-1]=multiplyPdfMatrices(args,top);
}else if(fn===OPS.paintImageXObject||fn===OPS.paintJpegXObject){
var ctm=stack[stack.length-1];
try{
var imgObj=page.objs.get(args[0]);
images.push({
name:args[0],
x:ctm[4],y:ctm[5],
width:Math.hypot(ctm[0],ctm[1]),
height:Math.hypot(ctm[2],ctm[3]),
imgObj:imgObj
});
}catch(e){
/* Image object failed to resolve; skip it rather than fail
   the whole page's conversion over one picture. */
}
}
}
return images;
}

/* Draws a resolved pdf.js image object (bitmap or raw RGBA data)
   onto a canvas and returns it as a PNG blob for embedding. */
function pdfImageObjectToBlob(imgObj){
var canvas=document.createElement("canvas");
canvas.width=imgObj.width;canvas.height=imgObj.height;
var ctx=canvas.getContext("2d");
if(!ctx)return Promise.resolve(null);
if(imgObj.bitmap){
ctx.drawImage(imgObj.bitmap,0,0);
}else if(imgObj.data){
try{
var imageData=ctx.createImageData(imgObj.width,imgObj.height);
if(imgObj.data.length===imageData.data.length){
imageData.data.set(imgObj.data);
}else{
/* RGB (3 bytes/px) rather than RGBA -- expand it. */
var src=imgObj.data,dst=imageData.data;
for(var p=0,s=0;p<dst.length;p+=4,s+=3){
dst[p]=src[s];dst[p+1]=src[s+1];dst[p+2]=src[s+2];dst[p+3]=255;
}
}
ctx.putImageData(imageData,0,0);
}catch(e){return Promise.resolve(null);}
}else{
return Promise.resolve(null);
}
return new Promise(function(resolve){canvas.toBlob(resolve,"image/png");});
}

function getFontStyle(page,fontName){
try{
var fontObj=page.commonObjs.get(fontName);
return {bold:!!fontObj.bold,italic:!!fontObj.italic};
}catch(e){
return {bold:false,italic:false};
}
}

/* Reads one page's styled text items (with bold/italic/fontSize per
   item) and any images it contains, doing the minimum work needed:
   a page render is only performed when the page actually has an
   image to resolve. */
function getPdfPageData(page){
return Promise.all([page.getOperatorList(),page.getTextContent()]).then(function(results){
var opList=results[0],content=results[1];
var OPS=window.pdfjsLib.OPS;
var hasImages=false;
for(var i=0;i<opList.fnArray.length;i++){
if(opList.fnArray[i]===OPS.paintImageXObject||opList.fnArray[i]===OPS.paintJpegXObject){hasImages=true;break;}
}
var renderPromise=Promise.resolve();
if(hasImages){
var viewport=page.getViewport({scale:1});
var canvas=document.createElement("canvas");
canvas.width=viewport.width;canvas.height=viewport.height;
var ctx=canvas.getContext("2d");
if(ctx){
renderPromise=page.render({canvasContext:ctx,viewport:viewport}).promise.catch(function(){});
}
}
return renderPromise.then(function(){
var images=hasImages?extractPageImages(page,opList):[];
var styledItems=[];
content.items.forEach(function(item){
if(!item.str||!item.str.trim())return;
var style=getFontStyle(page,item.fontName);
var fontSize=Math.hypot(item.transform[0],item.transform[1])||10;
styledItems.push({
str:item.str,
x:item.transform[4],
y:item.transform[5],
width:item.width||0,
bold:style.bold,
italic:style.italic,
fontSize:fontSize
});
});
return {styledItems:styledItems,images:images};
});
});
}

/* Groups a page's styled text items into visual rows (by y), then
   splits each row into "fields" (table-cell / line-fragment
   candidates) wherever a wide horizontal gap suggests a column
   break. Adjacent items are merged into the same run only while
   their bold/italic stay the same, so mixed formatting on one line
   (e.g. a bold label immediately followed by a plain value) is kept
   as separate runs instead of collapsing to one style. */
function groupPdfItemsIntoRows(items){
var rows=[];
var currentRowItems=null;
var lastY=null;

items.forEach(function(item){
if(lastY===null||Math.abs(item.y-lastY)>2){
if(currentRowItems)rows.push(currentRowItems);
currentRowItems=[];
}
currentRowItems.push(item);
lastY=item.y;
});
if(currentRowItems)rows.push(currentRowItems);

return rows.map(function(rowItems){
rowItems.sort(function(a,b){return a.x-b.x;});
var fields=[];
var current=null;
rowItems.forEach(function(it){
var endX=it.x+(it.width||0);
if(current===null){
current={x:it.x,endX:endX,runs:[{text:it.str,bold:it.bold,italic:it.italic,fontSize:it.fontSize}]};
}else{
var gap=it.x-current.endX;
if(gap>PDF_COLUMN_GAP_PT){
fields.push(current);
current={x:it.x,endX:endX,runs:[{text:it.str,bold:it.bold,italic:it.italic,fontSize:it.fontSize}]};
}else{
var lastRun=current.runs[current.runs.length-1];
var needsSpace=!/\s$/.test(lastRun.text)&&!/^\s/.test(it.str);
if(lastRun.bold===it.bold&&lastRun.italic===it.italic){
lastRun.text+=(needsSpace?" ":"")+it.str;
}else{
if(needsSpace)lastRun.text+=" ";
current.runs.push({text:it.str,bold:it.bold,italic:it.italic,fontSize:it.fontSize});
}
current.endX=endX;
}
}
});
if(current)fields.push(current);
return {y:rowItems[0].y,fields:fields};
});
}

function fieldPlainText(field){
return field.runs.map(function(r){return r.text;}).join("");
}

function rowMaxFontSize(row){
var max=0;
row.fields.forEach(function(f){f.runs.forEach(function(r){if(r.fontSize>max)max=r.fontSize;});});
return max||10;
}

/* Combines a non-table row's fields into one paragraph's worth of
   runs, in left-to-right order, inserting a spacing run between
   fields that were originally separated by a wide gap on the page
   (e.g. a label and its value). */
function rowToParagraphRuns(row){
var runs=[];
row.fields.forEach(function(field,idx){
if(idx>0)runs.push({text:"    ",bold:false,italic:false,fontSize:field.runs[0].fontSize});
field.runs.forEach(function(r){runs.push(r);});
});
return runs;
}

function rowToParagraphBlock(row,bodyFontSize){
var size=rowMaxFontSize(row);
return {
type:"paragraph",
runs:rowToParagraphRuns(row),
y:row.y,
isHeading:size>=bodyFontSize*PDF_HEADING_SIZE_RATIO
};
}

/* Cluster a set of x positions into column "centers" so fields that
   start at roughly the same x (across different rows) land in the
   same table column, even when a row is missing some cells. */
function clusterColumnPositions(xPositions){
var sorted=xPositions.slice().sort(function(a,b){return a-b;});
var clusters=[];
sorted.forEach(function(x){
var last=clusters[clusters.length-1];
if(last&&(x-last.sum/last.count)<=PDF_COLUMN_MERGE_PT){
last.sum+=x;last.count++;
}else{
clusters.push({sum:x,count:1});
}
});
return clusters.slice(0,PDF_MAX_TABLE_COLUMNS).map(function(c){return c.sum/c.count;});
}

function assignFieldsToColumns(fields,centers){
var row=new Array(centers.length).fill(null);
fields.forEach(function(f){
var bestIdx=0,bestDist=Infinity;
for(var i=0;i<centers.length;i++){
var d=Math.abs(f.x-centers[i]);
if(d<bestDist){bestDist=d;bestIdx=i;}
}
if(row[bestIdx]&&row[bestIdx].runs.length){
row[bestIdx]={runs:row[bestIdx].runs.concat([{text:" ",bold:false,italic:false,fontSize:f.runs[0].fontSize}],f.runs)};
}else{
row[bestIdx]={runs:f.runs.slice()};
}
});
for(var i=0;i<row.length;i++){if(!row[i])row[i]={runs:[]};}
return row;
}

/* A cell whose text wraps onto a second visual line in the source PDF
   (e.g. a Remarks column showing "Off Day" / "OverTime" on two lines)
   shows up as its own near-empty grid row. Fold any row that only has
   content in one non-first column back into the row above it, so
   wrapped cell text is reunited instead of scattered across rows. */
function mergeWrappedContinuationRows(gridRows){
var out=[];
gridRows.forEach(function(row){
var nonEmptyIdx=[];
row.forEach(function(cell,idx){if(cell&&cell.runs&&cell.runs.length)nonEmptyIdx.push(idx);});
if(out.length>0&&nonEmptyIdx.length===1&&nonEmptyIdx[0]!==0){
var idx=nonEmptyIdx[0];
var prev=out[out.length-1];
if(prev[idx]&&prev[idx].runs.length){
prev[idx]={runs:prev[idx].runs.concat([{text:" ",bold:false,italic:false,fontSize:10}],row[idx].runs)};
}else{
prev[idx]=row[idx];
}
}else{
out.push(row.slice());
}
});
return out;
}

/* Two real, flowing text columns (a resume, a newsletter) can end up
   looking exactly like a simple 2-column table once grouped by row,
   if the PDF's underlying content stream interleaves the columns
   line-by-line. Long, sentence-like cell text (rather than short
   data values) is the signal that this is prose, not a data table --
   in which case it reads correctly as "all of column 1, then all of
   column 2" rather than as a table. */
function looksLikeTwoColumnProse(gridRows){
if(gridRows.length===0||gridRows[0].length!==2)return false;
var totalLen=0,count=0;
gridRows.forEach(function(row){
row.forEach(function(cell){
var text=cell&&cell.runs?cell.runs.map(function(r){return r.text;}).join(""):"";
if(text){totalLen+=text.length;count++;}
});
});
if(count===0)return false;
return (totalLen/count)>=15&&gridRows.length>=3;
}

function twoColumnGridToParagraphBlocks(gridRows,bodyFontSize){
var blocks=[];
[0,1].forEach(function(colIdx){
gridRows.forEach(function(row){
var cell=row[colIdx];
if(cell&&cell.runs&&cell.runs.length){
var size=cell.runs.reduce(function(m,r){return Math.max(m,r.fontSize);},0)||bodyFontSize;
blocks.push({type:"paragraph",runs:cell.runs,isHeading:size>=bodyFontSize*PDF_HEADING_SIZE_RATIO});
}
});
});
return blocks;
}

/* When a page has no table at all, its paragraph rows might still be
   two genuinely side-by-side columns (rather than a data table) if
   the underlying content stream emits them in visual-row order. Try
   to split rows with exactly one field each into two x-bands; if a
   clean, consistent split exists, reorder as column 1 fully then
   column 2 fully instead of raw top-to-bottom row order. */
function reorderSingleFieldRowsByColumnBand(rows){
if(rows.length<4)return rows;
var singleFieldRows=rows.filter(function(r){return r.fields.length===1;});
if(singleFieldRows.length<rows.length*0.6)return rows; /* too mixed with multi-field rows to trust a column split */

var xs=singleFieldRows.map(function(r){return r.fields[0].x;});
xs.sort(function(a,b){return a-b;});
/* find the largest gap in start-x values -- a real column gutter
   should be much wider than normal left-margin jitter */
var bestGapIdx=-1,bestGap=0;
for(var i=1;i<xs.length;i++){
var gap=xs[i]-xs[i-1];
if(gap>bestGap){bestGap=gap;bestGapIdx=i;}
}
if(bestGapIdx===-1||bestGap<40)return rows; /* no convincing column gutter */
var splitX=(xs[bestGapIdx-1]+xs[bestGapIdx])/2;

var left=[],right=[];
var allSingle=rows.every(function(r){return r.fields.length===1;});
if(!allSingle)return rows; /* keep it simple: only reorder pure single-column-per-line pages */

rows.forEach(function(r){
if(r.fields[0].x<splitX)left.push(r);else right.push(r);
});
if(left.length<2||right.length<2)return rows;
return left.concat(right);
}

/* Turns one PDF page's styled items into a mix of paragraph blocks
   (titles, notes, two-column prose) and table blocks (grid-like
   data), based on where multi-column rows start appearing. */
function pageContentToBlocks(styledItems,bodyFontSize){
var rows=groupPdfItemsIntoRows(styledItems);
var blocks=[];
var tableStartIndex=rows.findIndex(function(r){return r.fields.length>=2;});

if(tableStartIndex===-1){
rows=reorderSingleFieldRowsByColumnBand(rows);
rows.forEach(function(r){blocks.push(rowToParagraphBlock(r,bodyFontSize));});
return blocks;
}

rows.slice(0,tableStartIndex).forEach(function(r){
blocks.push(rowToParagraphBlock(r,bodyFontSize));
});

var tableRows=rows.slice(tableStartIndex);
var candidateStarts=[];
tableRows.forEach(function(r){
if(r.fields.length>=2){r.fields.forEach(function(f){candidateStarts.push(f.x);});}
});
var centers=clusterColumnPositions(candidateStarts);

if(centers.length<2){
tableRows.forEach(function(r){blocks.push(rowToParagraphBlock(r,bodyFontSize));});
return blocks;
}

var gridRows=tableRows.map(function(r){return assignFieldsToColumns(r.fields,centers);});
gridRows=mergeWrappedContinuationRows(gridRows);

if(looksLikeTwoColumnProse(gridRows)){
twoColumnGridToParagraphBlocks(gridRows,bodyFontSize).forEach(function(b){blocks.push(b);});
}else{
blocks.push({type:"table",rows:gridRows,y:tableRows[0].y});
}
return blocks;
}

function extractPdfBlocks(file){
if(!window.pdfjsLib){throw new Error("PDF library is unavailable. Please refresh the page.");}
return file.arrayBuffer().then(function(bytes){
return window.pdfjsLib.getDocument({data:bytes}).promise;
}).then(function(pdf){
var pagesData=[];
var chain=Promise.resolve();
for(var pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
(function(pageNumber){
chain=chain.then(function(){return pdf.getPage(pageNumber);})
.then(function(page){return getPdfPageData(page);})
.then(function(data){pagesData.push(data);});
})(pageNumber);
}
return chain.then(function(){
/* A single body-text size for the whole document gives a stable
   baseline for "this line is bigger than normal body text" (i.e.
   a heading), rather than guessing per page. */
var allSizes=[];
pagesData.forEach(function(d){d.styledItems.forEach(function(it){allSizes.push(it.fontSize);});});
allSizes.sort(function(a,b){return a-b;});
var bodyFontSize=allSizes.length?allSizes[Math.floor(allSizes.length/2)]:10;

var imagePromises=[];
pagesData.forEach(function(d){
d.images.forEach(function(img){
imagePromises.push(pdfImageObjectToBlob(img.imgObj).then(function(blob){
img.blob=blob;
}));
});
});

return Promise.all(imagePromises).then(function(){
var blocks=[];
pagesData.forEach(function(pageData,pageIdx){
if(pageIdx>0)blocks.push({type:"pagebreak"});
var pageBlocks=pageContentToBlocks(pageData.styledItems,bodyFontSize);
/* Merge in this page's images by descending y (top of page
   first), inserting each one just before the first text block
   that comes later in reading order. */
var images=pageData.images.filter(function(img){return img.blob;});
images.sort(function(a,b){return b.y-a.y;});
images.forEach(function(img){
var insertAt=pageBlocks.length;
for(var i=0;i<pageBlocks.length;i++){
if(typeof pageBlocks[i].y==="number"&&pageBlocks[i].y<img.y){insertAt=i;break;}
}
pageBlocks.splice(insertAt,0,{type:"image",blob:img.blob,mimeType:"image/png",width:img.width,height:img.height});
});
pageBlocks.forEach(function(b){blocks.push(b);});
});
return blocks;
});
});
});
}

function handlePdfToWord(files,statusEl,resultArea){
var file=files[0];
return extractPdfBlocks(file).then(function(blocks){
return buildDocxFromBlocks(blocks);
}).then(function(blob){
setStatus(statusEl,"Converted and saved as a Word document.","success");
resultArea.appendChild(createDownloadLink(blob,toolTexxOutputName(file.name,"docx")));
});
}


/* =========================================================
   IMAGE HELPERS
========================================================= */

function loadImageFromFile(file){
return new Promise(function(resolve,reject){
var img=new Image();
img.onload=function(){resolve(img);};
img.onerror=function(){reject(new Error("Unable to read this image."));};
img.src=URL.createObjectURL(file);
});
}

function drawImageToCanvas(img,fillWhite){
var canvas=document.createElement("canvas");
canvas.width=img.width;canvas.height=img.height;
var ctx=canvas.getContext("2d");
if(fillWhite){ctx.fillStyle="#ffffff";ctx.fillRect(0,0,canvas.width,canvas.height);}
ctx.drawImage(img,0,0);
return canvas;
}

function convertImageFormatHandler(files,statusEl,resultArea,mimeType,extension){
var file=files[0];
var previewUrl=null;
return loadImageFromFile(file).then(function(img){
previewUrl=img.src;
var needsWhiteBg=(mimeType==="image/jpeg");
var canvas=drawImageToCanvas(img,needsWhiteBg);
return new Promise(function(resolve){canvas.toBlob(resolve,mimeType,0.92);});
}).then(function(blob){
if(previewUrl && previewUrl.indexOf("blob:")===0){URL.revokeObjectURL(previewUrl);}
if(!blob)throw new Error("Conversion failed.");
setStatus(statusEl,"Image converted successfully.","success");
resultArea.appendChild(createDownloadLink(blob,toolTexxOutputName(file.name,extension)));
});
}

function handleImageConverter(files,statusEl,resultArea){
var mimeType=document.getElementById("targetFormat").value;
var extMap={"image/png":"png","image/jpeg":"jpg","image/webp":"webp"};
return convertImageFormatHandler(files,statusEl,resultArea,mimeType,extMap[mimeType]);
}

/* =========================================================
   SMART IMAGE COMPRESSOR
========================================================= */

function buildSmartImageCompressor(container) {
  if (!container) return;

  container.innerHTML = "";

  var wrapper = document.createElement("div");
  wrapper.className = "tooltexx-smart-compressor";

  wrapper.innerHTML = `
    <div class="compressor-panel">

      <div class="compressor-upload-box">
        <input
          type="file"
          id="ttxCompressorFile"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          hidden
        >

        <button type="button" class="tool-btn primary" id="ttxChooseImage">
          Choose Image
        </button>

        <div id="ttxFileInfo" class="compressor-file-info">
          No image selected
        </div>
      </div>

      <div id="ttxCompressorControls" style="display:none">

        <div class="compressor-info-card">
          <div>
            <strong>Original</strong>
            <span id="ttxOriginalSize">—</span>
          </div>

          <div>
            <strong>Dimensions</strong>
            <span id="ttxOriginalDimensions">—</span>
          </div>
        </div>

        <label class="compressor-label">
          Compression Mode
        </label>

        <select id="ttxCompressionMode" class="compressor-select">
          <option value="best">Best Quality</option>
          <option value="balanced" selected>Balanced</option>
          <option value="maximum">Maximum Compression</option>
          <option value="target">Target File Size</option>
        </select>

        <div id="ttxTargetBox" style="display:none">

          <label class="compressor-label">
            Target File Size
          </label>

          <select id="ttxTargetPreset" class="compressor-select">
            <option value="5242880">5 MB</option>
            <option value="2097152">2 MB</option>
            <option value="1048576" selected>1 MB</option>
            <option value="512000">500 KB</option>
            <option value="204800">200 KB</option>
            <option value="102400">100 KB</option>
            <option value="custom">Custom</option>
          </select>

          <div id="ttxCustomTargetBox" style="display:none">
            <input
              id="ttxCustomTarget"
              class="compressor-input"
              type="number"
              min="10"
              step="1"
              placeholder="Enter target in KB"
            >
          </div>

          <div class="compressor-hint">
            A target size is not always achievable without visible quality loss. We get as close as practical and tell you honestly if it can't be reached.
          </div>

        </div>

        <label class="compressor-label">
          Output Format
        </label>

        <select id="ttxOutputFormat" class="compressor-select">
          <option value="image/jpeg" selected>JPG</option>
          <option value="image/webp">WebP</option>
          <option value="image/png">PNG</option>
        </select>

        <div id="ttxPngNote" class="compressor-note" style="display:none">
          PNG is lossless, so it won't shrink as much as JPG or WebP. For a much smaller file, switch the format above.
        </div>

        <div id="ttxQualityBox">

          <div class="compressor-quality-header">
            <label class="compressor-label">
              Quality
            </label>

            <strong>
              <span id="ttxQualityValue">82</span>%
            </strong>
          </div>

          <div class="compressor-hint">
            Higher quality keeps more detail but produces a larger file.
          </div>

          <input
            id="ttxQuality"
            type="range"
            min="10"
            max="100"
            value="82"
            step="1"
            class="compressor-range"
          >

        </div>

        <button
          type="button"
          class="tool-btn primary compressor-action"
          id="ttxCompressButton"
        >
          Compress Image
        </button>

        <button
          type="button"
          class="tool-btn secondary"
          id="ttxResetCompressor"
        >
          Choose Another Image
        </button>

        <div id="ttxCompressorStatus" class="status-msg"></div>

        <div id="ttxCompressorResult" style="display:none">

          <div class="compressor-result-card">

            <div class="compressor-result-grid">

              <div>
                <strong>Original Size</strong>
                <span id="ttxResultOriginal">—</span>
              </div>

              <div>
                <strong>Compressed Size</strong>
                <span id="ttxResultCompressed">—</span>
              </div>

              <div>
                <strong>Reduction</strong>
                <span id="ttxResultReduction">—</span>
              </div>

              <div>
                <strong>Output Dimensions</strong>
                <span id="ttxResultDimensions">—</span>
              </div>

            </div>

            <div class="compressor-format-line">
              <strong>Output Format:</strong> <span id="ttxResultFormat">—</span>
            </div>

            <div class="compressor-preview-wrap">
              <img
                id="ttxCompressorPreview"
                alt="Compressed image preview"
              >
            </div>

            <div id="ttxTargetMessage" class="compressor-target-message"></div>

            <div id="ttxDownloadArea"></div>

          </div>

        </div>

      </div>
    </div>
  `;

  container.appendChild(wrapper);

  var fileInput = wrapper.querySelector("#ttxCompressorFile");
  var chooseButton = wrapper.querySelector("#ttxChooseImage");
  var fileInfo = wrapper.querySelector("#ttxFileInfo");
  var controls = wrapper.querySelector("#ttxCompressorControls");

  var mode = wrapper.querySelector("#ttxCompressionMode");
  var targetBox = wrapper.querySelector("#ttxTargetBox");
  var targetPreset = wrapper.querySelector("#ttxTargetPreset");
  var customTargetBox = wrapper.querySelector("#ttxCustomTargetBox");
  var customTarget = wrapper.querySelector("#ttxCustomTarget");

  var format = wrapper.querySelector("#ttxOutputFormat");
  var pngNote = wrapper.querySelector("#ttxPngNote");
  var quality = wrapper.querySelector("#ttxQuality");
  var qualityValue = wrapper.querySelector("#ttxQualityValue");
  var qualityBox = wrapper.querySelector("#ttxQualityBox");

  var compressButton = wrapper.querySelector("#ttxCompressButton");
  var resetButton = wrapper.querySelector("#ttxResetCompressor");

  var status = wrapper.querySelector("#ttxCompressorStatus");
  var result = wrapper.querySelector("#ttxCompressorResult");

  var originalSizeEl = wrapper.querySelector("#ttxOriginalSize");
  var originalDimensionsEl = wrapper.querySelector("#ttxOriginalDimensions");

  var resultOriginal = wrapper.querySelector("#ttxResultOriginal");
  var resultCompressed = wrapper.querySelector("#ttxResultCompressed");
  var resultReduction = wrapper.querySelector("#ttxResultReduction");
  var resultDimensions = wrapper.querySelector("#ttxResultDimensions");
  var resultFormat = wrapper.querySelector("#ttxResultFormat");

  var preview = wrapper.querySelector("#ttxCompressorPreview");
  var targetMessage = wrapper.querySelector("#ttxTargetMessage");
  var downloadArea = wrapper.querySelector("#ttxDownloadArea");

  var selectedFile = null;
  var selectedImage = null; // { source, width, height, isBitmap }
  var previewURL = null;
  var downloadURL = null;

  /*
    Mobile / memory safety.
    Very large phone photos (40MP+) can crash or freeze low-memory
    devices when repeatedly drawn to Canvas (iOS Safari in particular
    has a hard Canvas area ceiling around 16.7 megapixels). We cap the
    WORKING baseline used for compression math, while the "Dimensions"
    field shown right after upload always reflects the TRUE original size.
  */
  var MAX_CANVAS_DIMENSION = 4096;
  var MAX_CANVAS_PIXELS = 16000000;

  /*
    Fixed, controlled dimension-reduction ladder.
    Replaces an exponential scale*=0.82 curve (which reduced dimensions
    too aggressively and too unpredictably) with gentle, predictable steps.
  */
  var DIMENSION_STEPS = [1, 0.9, 0.8, 0.7, 0.6, 0.5];
  var MIN_DIMENSION_FLOOR = 320;

  var MAX_CUSTOM_TARGET_KB = 500000; // 500MB — not a sensible target for a browser image tool

  function sizeText(bytes) {
    if (bytes < 1024) {
      return bytes + " Bytes";
    }

    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + " KB";
    }

    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  function reductionText(original, compressed) {
    if (!original || compressed >= original) {
      return "0%";
    }

    return (((original - compressed) / original) * 100).toFixed(1) + "%";
  }

  function getTargetBytes() {
    if (targetPreset.value === "custom") {
      var kb = Number(customTarget.value);

      if (!isFinite(kb) || kb <= 0 || kb > MAX_CUSTOM_TARGET_KB) {
        return null;
      }

      return Math.round(kb * 1024);
    }

    return Number(targetPreset.value);
  }

  function getInitialQuality() {
    if (mode.value === "best") {
      return 0.92;
    }

    if (mode.value === "maximum") {
      return 0.55;
    }

    if (mode.value === "target") {
      return 0.82;
    }

    return 0.78;
  }

  function applyModeQualityDefault() {
    var defaultQuality = Math.round(getInitialQuality() * 100);
    quality.value = defaultQuality;
    qualityValue.textContent = defaultQuality;
  }

  function getMimeExtension(mime) {
    if (mime === "image/webp") return "webp";
    if (mime === "image/png") return "png";
    return "jpg";
  }

  function getFormatLabel(mime) {
    if (mime === "image/webp") return "WebP";
    if (mime === "image/png") return "PNG";
    return "JPG";
  }

  function makeOutputName(originalName, mime) {
    var base = typeof baseNameWithoutExt === "function"
      ? baseNameWithoutExt(originalName)
      : String(originalName || "image").replace(/\.[^/.]+$/, "");

    var ext = getMimeExtension(mime);

    /*
      Preserve the existing ToolTexx filename convention when available.
    */
    if (typeof toolTexxOutputName === "function") {
      return toolTexxOutputName(originalName, ext);
    }

    return base + " ToolTexx converted." + ext;
  }

  function canvasBlob(canvas, mime, qualityValueLocal) {
    return new Promise(function(resolve, reject) {

      canvas.toBlob(function(blob) {

        if (!blob) {
          reject(new Error("The browser could not create the compressed image."));
          return;
        }

        resolve(blob);

      }, mime, qualityValueLocal);

    });
  }

  function drawImageToCanvas(source, width, height) {
    var canvas = document.createElement("canvas");

    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));

    var ctx = canvas.getContext("2d", {
      alpha: true
    });

    if (!ctx) {
      throw new Error("Canvas is not supported by this browser.");
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(
      source,
      0,
      0,
      canvas.width,
      canvas.height
    );

    return canvas;
  }

  function releaseCanvas(canvas) {
    /*
      Helps the browser reclaim the backing pixel buffer sooner on
      memory-constrained mobile devices, instead of waiting on normal GC.
    */
    if (!canvas) return;
    canvas.width = 0;
    canvas.height = 0;
  }

  function loadImageFallback(file) {
    return new Promise(function(resolve, reject) {

      var url = URL.createObjectURL(file);
      var img = new Image();

      img.onload = function() {
        URL.revokeObjectURL(url);
        resolve({
          source: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
          isBitmap: false
        });
      };

      img.onerror = function() {
        URL.revokeObjectURL(url);
        reject(new Error("This image could not be read."));
      };

      img.src = url;
    });
  }

  /*
    Orientation-safe, memory-aware image loading.
    createImageBitmap with imageOrientation:"from-image" bakes the
    photo's EXIF rotation into the decoded pixels, so a portrait phone
    photo can never come out sideways after Canvas processing (a known
    inconsistency with plain <img> + drawImage on some platforms).
    Falls back to the classic <img> decode where unsupported.
  */
  function loadImage(file) {
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(file, { imageOrientation: "from-image" })
        .then(function(bitmap) {
          return {
            source: bitmap,
            width: bitmap.width,
            height: bitmap.height,
            isBitmap: true
          };
        })
        .catch(function() {
          return loadImageFallback(file);
        });
    }

    return loadImageFallback(file);
  }

  function releaseImage(imageInfo) {
    if (imageInfo && imageInfo.isBitmap && typeof imageInfo.source.close === "function") {
      imageInfo.source.close();
    }
  }

  /*
    The working baseline for compression math. Caps pathologically large
    source photos to a memory-safe size so mobile browsers don't run out
    of Canvas memory. The "Dimensions" field shown right after upload
    always reflects the TRUE original size — this cap only affects the
    internal processing baseline.
  */
  function getSafeBaseDimensions(width, height) {
    var scaleDown = 1;

    if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION) {
      scaleDown = Math.min(scaleDown, MAX_CANVAS_DIMENSION / Math.max(width, height));
    }

    var projectedPixels = width * height * scaleDown * scaleDown;

    if (projectedPixels > MAX_CANVAS_PIXELS) {
      scaleDown = Math.min(scaleDown, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
    }

    return {
      width: Math.max(1, Math.round(width * scaleDown)),
      height: Math.max(1, Math.round(height * scaleDown))
    };
  }

  function calculateDimensions(baseDimensions, scale) {
    return {
      width: Math.max(1, Math.round(baseDimensions.width * scale)),
      height: Math.max(1, Math.round(baseDimensions.height * scale))
    };
  }

  function compressionSettings() {
    /*
      The mode sets a sensible DEFAULT (see applyModeQualityDefault), but
      the visible Quality slider is the control that actually gets applied.
      Previously this returned a fixed number per mode and silently
      ignored the slider entirely — which is why "Balanced" output always
      looked the same (sometimes too soft) no matter how far the user
      moved the slider. That's fixed here.
    */
    var sliderQuality = Number(quality.value) / 100;

    if (!isFinite(sliderQuality) || sliderQuality <= 0 || sliderQuality > 1) {
      sliderQuality = getInitialQuality();
    }

    return {
      quality: sliderQuality,
      scale: 1
    };
  }

  async function normalCompression(imageInfo, mime) {

    var settings = compressionSettings();
    var safeBase = getSafeBaseDimensions(imageInfo.width, imageInfo.height);

    var dimensions = calculateDimensions(
      safeBase,
      settings.scale
    );

    var canvas = drawImageToCanvas(
      imageInfo.source,
      dimensions.width,
      dimensions.height
    );

    /*
      PNG does not use JPEG/WebP quality in the same way.
    */
    var q = mime === "image/png"
      ? undefined
      : settings.quality;

    var blob;

    try {
      blob = await canvasBlob(
        canvas,
        mime,
        q
      );
    } finally {
      releaseCanvas(canvas);
    }

    return {
      blob: blob,
      width: dimensions.width,
      height: dimensions.height,
      quality: settings.quality
    };
  }

  async function targetCompression(imageInfo, mime, targetBytes) {

    if (!targetBytes) {
      throw new Error("Please select a valid target file size.");
    }

    var maxIterations = 8;
    var safeBase = getSafeBaseDimensions(imageInfo.width, imageInfo.height);

    /*
      Try quality alone first, at each dimension step, before reducing
      dimensions further. This avoids destroying resolution when a lower
      quality encode at full size would already have reached the target.
    */
    for (var stepIndex = 0; stepIndex < DIMENSION_STEPS.length; stepIndex++) {

      var scale = DIMENSION_STEPS[stepIndex];

      var dimensions = calculateDimensions(
        safeBase,
        scale
      );

      if (
        stepIndex > 0 &&
        (dimensions.width < MIN_DIMENSION_FLOOR ||
         dimensions.height < MIN_DIMENSION_FLOOR)
      ) {
        break;
      }

      var canvas = drawImageToCanvas(
        imageInfo.source,
        dimensions.width,
        dimensions.height
      );

      try {

        var low = 0.10;
        var high = 0.96;

        var bestBlob = null;
        var bestQuality = 0.10;

        var highBlob = await canvasBlob(
          canvas,
          mime,
          mime === "image/png" ? undefined : high
        );

        if (highBlob.size <= targetBytes) {

          bestBlob = highBlob;
          bestQuality = high;

          /*
            Binary search for the highest quality that still fits.
            Reuses the SAME canvas for every attempt at this dimension
            step, since only the encode quality changes — not the
            pixels — which avoids repeatedly re-drawing/allocating.
          */
          if (mime !== "image/png") {

            for (var i = 0; i < maxIterations; i++) {

              var mid = (low + high) / 2;

              var midBlob = await canvasBlob(
                canvas,
                mime,
                mid
              );

              if (midBlob.size <= targetBytes) {
                bestBlob = midBlob;
                bestQuality = mid;
                low = mid;
              } else {
                high = mid;
              }
            }
          }

          return {
            blob: bestBlob,
            width: dimensions.width,
            height: dimensions.height,
            quality: mime === "image/png" ? null : bestQuality,
            reachedTarget: bestBlob.size <= targetBytes,
            dimensionReduced: scale < 0.999
          };
        }

      } finally {
        releaseCanvas(canvas);
      }

      /*
        Quality alone (or PNG's lossless encode) couldn't hit the target
        at this size — move to the next, smaller dimension step and retry.
      */
    }

    /*
      Final fallback: the smallest step we tried, at a conservative quality.
    */
    var finalScale = DIMENSION_STEPS[DIMENSION_STEPS.length - 1];
    var finalDimensions = calculateDimensions(
      safeBase,
      finalScale
    );

    var finalCanvas = drawImageToCanvas(
      imageInfo.source,
      finalDimensions.width,
      finalDimensions.height
    );

    var finalBlob;

    try {
      finalBlob = await canvasBlob(
        finalCanvas,
        mime,
        mime === "image/png" ? undefined : 0.45
      );
    } finally {
      releaseCanvas(finalCanvas);
    }

    return {
      blob: finalBlob,
      width: finalDimensions.width,
      height: finalDimensions.height,
      quality: mime === "image/png" ? null : 0.45,
      reachedTarget: finalBlob.size <= targetBytes,
      dimensionReduced: true
    };
  }

  function showTargetMessage(compression, targetBytes, mime) {

    if (!targetBytes) {
      targetMessage.textContent = "";
      targetMessage.className = "compressor-target-message";
      return;
    }

    if (compression.reachedTarget) {

      targetMessage.textContent = mime === "image/png"
        ? "Target size reached. Since PNG is lossless, this came from resizing rather than quality reduction."
        : "Target size reached while preserving the best practical quality.";

      targetMessage.className =
        "compressor-target-message success";

      return;
    }

    targetMessage.textContent = mime === "image/png"
      ? "PNG is lossless and couldn't reach this target without excessive resizing. For a much smaller file, try JPG or WebP instead."
      : "The requested target could not be reached without excessive quality or dimension loss. A safer compressed result is shown instead.";

    targetMessage.className =
      "compressor-target-message warning";
  }

  async function compressSelectedImage() {

    if (!selectedFile || !selectedImage) {
      setStatus(
        status,
        "Please choose an image first.",
        "error"
      );
      return;
    }

    compressButton.disabled = true;
    resetButton.disabled = true;
    chooseButton.disabled = true;

    result.style.display = "none";
    downloadArea.innerHTML = "";
    targetMessage.textContent = "";
    targetMessage.className = "compressor-target-message";

    setStatus(
      status,
      "Compressing image… please wait.",
      ""
    );

    try {

      var mime = format.value;
      var targetBytes = null;

      if (mode.value === "target") {
        targetBytes = getTargetBytes();

        if (!targetBytes) {
          throw new Error(
            "Please enter a valid target size."
          );
        }
      }

      var compression;

      if (mode.value === "target") {

        compression = await targetCompression(
          selectedImage,
          mime,
          targetBytes
        );

      } else {

        compression = await normalCompression(
          selectedImage,
          mime
        );

      }

      var blob = compression.blob;

      if (!blob || !blob.size) {
        throw new Error(
          "Compression failed. Please try another image or format."
        );
      }

      if (downloadURL) {
        URL.revokeObjectURL(downloadURL);
      }

      downloadURL = URL.createObjectURL(blob);

      if (previewURL) {
        URL.revokeObjectURL(previewURL);
      }

      previewURL = URL.createObjectURL(blob);

      preview.src = previewURL;

      resultOriginal.textContent =
        sizeText(selectedFile.size);

      resultCompressed.textContent =
        sizeText(blob.size);

      resultReduction.textContent =
        reductionText(
          selectedFile.size,
          blob.size
        );

      resultDimensions.textContent =
        compression.width +
        " × " +
        compression.height;

      resultFormat.textContent =
        getFormatLabel(mime);

      var filename = makeOutputName(
        selectedFile.name,
        mime
      );

      var link = document.createElement("a");

      link.href = downloadURL;
      link.download = filename;
      link.className = "download-link";
      link.textContent = "Download " + filename;

      downloadArea.appendChild(link);

      if (mode.value === "target") {
        showTargetMessage(
          compression,
          targetBytes,
          mime
        );
      }

      result.style.display = "block";

      if (blob.size < selectedFile.size) {

        setStatus(
          status,
          "Compression complete.",
          "success"
        );

      } else {

        setStatus(
          status,
          "Compression complete. This image was already highly optimized, so the output could not be made smaller without reducing quality significantly.",
          "warning"
        );
      }

    } catch (error) {

      console.error(error);

      setStatus(
        status,
        error && error.message
          ? error.message
          : "Compression failed. Please try again.",
        "error"
      );

    } finally {

      compressButton.disabled = false;
      resetButton.disabled = false;
      chooseButton.disabled = false;
    }
  }

  function resetCompressor() {

    releaseImage(selectedImage);

    selectedFile = null;
    selectedImage = null;

    fileInput.value = "";

    controls.style.display = "none";

    fileInfo.textContent =
      "No image selected";

    originalSizeEl.textContent = "—";
    originalDimensionsEl.textContent = "—";

    result.style.display = "none";

    downloadArea.innerHTML = "";

    status.textContent = "";

    targetMessage.textContent = "";
    targetMessage.className = "compressor-target-message";

    if (previewURL) {
      URL.revokeObjectURL(previewURL);
      previewURL = null;
    }

    if (downloadURL) {
      URL.revokeObjectURL(downloadURL);
      downloadURL = null;
    }

    preview.removeAttribute("src");
  }

  function updateFormatVisibility() {
    var isPng = format.value === "image/png";
    var isTarget = mode.value === "target";

    pngNote.style.display = isPng ? "block" : "none";

    qualityBox.style.display = (isPng || isTarget) ? "none" : "block";
  }

  chooseButton.addEventListener(
    "click",
    function() {
      fileInput.click();
    }
  );

  fileInput.addEventListener(
    "change",
    async function() {

      var file = fileInput.files &&
                 fileInput.files[0];

      if (!file) return;

      if (
        !/^image\/(jpeg|jpg|png|webp)$/i.test(
          file.type
        )
      ) {

        setStatus(
          status,
          "Please choose a JPG, PNG, or WebP image.",
          "error"
        );

        fileInput.value = "";
        return;
      }

      selectedFile = file;

      setStatus(
        status,
        "Reading image…",
        ""
      );

      try {

        releaseImage(selectedImage);

        selectedImage = await loadImage(file);

        fileInfo.textContent =
          file.name +
          " • " +
          sizeText(file.size);

        originalSizeEl.textContent =
          sizeText(file.size);

        originalDimensionsEl.textContent =
          selectedImage.width +
          " × " +
          selectedImage.height;

        controls.style.display = "block";

        result.style.display = "none";

        setStatus(
          status,
          "Image ready.",
          "success"
        );

      } catch (error) {

        selectedFile = null;
        selectedImage = null;

        setStatus(
          status,
          error && error.message
            ? error.message
            : "Unable to read this image.",
          "error"
        );
      }
    }
  );

  mode.addEventListener(
    "change",
    function() {

      var isTarget =
        mode.value === "target";

      targetBox.style.display =
        isTarget ? "block" : "none";

      applyModeQualityDefault();

      updateFormatVisibility();
    }
  );

  targetPreset.addEventListener(
    "change",
    function() {

      customTargetBox.style.display =
        targetPreset.value === "custom"
          ? "block"
          : "none";
    }
  );

  format.addEventListener(
    "change",
    updateFormatVisibility
  );

  quality.addEventListener(
    "input",
    function() {

      qualityValue.textContent =
        quality.value;
    }
  );

  compressButton.addEventListener(
    "click",
    compressSelectedImage
  );

  resetButton.addEventListener(
    "click",
    resetCompressor
  );

  /*
    Image Compressor styling only.
    Do not modify the rest of the website styling.
    Injection is idempotent: repeated opens of this tool must not keep
    stacking duplicate <style> blocks into <head>.
  */
  if (!document.getElementById("ttxSmartCompressorStyle")) {

    var style = document.createElement("style");
    style.id = "ttxSmartCompressorStyle";

    style.textContent = `
      .tooltexx-smart-compressor {
        width: 100%;
        max-width: 760px;
        margin: 0 auto;
      }

      .tooltexx-smart-compressor .compressor-panel {
        width: 100%;
      }

      .tooltexx-smart-compressor .compressor-upload-box {
        text-align: center;
        padding: 22px;
        border: 2px dashed rgba(110, 70, 190, .28);
        border-radius: 18px;
        margin-bottom: 18px;
      }

      .tooltexx-smart-compressor .compressor-file-info {
        margin-top: 10px;
        font-size: 14px;
        opacity: .8;
        word-break: break-word;
      }

      .tooltexx-smart-compressor .compressor-info-card,
      .tooltexx-smart-compressor .compressor-result-card {
        border-radius: 18px;
        padding: 16px;
        margin: 14px 0;
        background: rgba(110, 70, 190, .06);
      }

      .tooltexx-smart-compressor .compressor-info-card {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }

      .tooltexx-smart-compressor .compressor-info-card div,
      .tooltexx-smart-compressor .compressor-result-grid div {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .tooltexx-smart-compressor .compressor-label {
        display: block;
        margin: 14px 0 7px;
        font-weight: 700;
      }

      .tooltexx-smart-compressor .compressor-select,
      .tooltexx-smart-compressor .compressor-input {
        width: 100%;
        box-sizing: border-box;
        padding: 12px 13px;
        border-radius: 12px;
        border: 1px solid rgba(0,0,0,.14);
        background: #fff;
        font: inherit;
      }

      .tooltexx-smart-compressor .compressor-hint {
        font-size: 12.5px;
        opacity: .68;
        margin: 4px 0 10px;
      }

      .tooltexx-smart-compressor .compressor-note {
        font-size: 13px;
        padding: 10px 12px;
        border-radius: 10px;
        background: rgba(230, 150, 30, .10);
        margin: -6px 0 14px;
      }

      .tooltexx-smart-compressor .compressor-quality-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .tooltexx-smart-compressor .compressor-range {
        width: 100%;
        margin: 0 0 12px;
      }

      .tooltexx-smart-compressor .compressor-action {
        width: 100%;
        margin-top: 14px;
      }

      .tooltexx-smart-compressor .compressor-result-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
        margin-bottom: 14px;
      }

      .tooltexx-smart-compressor .compressor-format-line {
        font-size: 14px;
        margin-bottom: 16px;
      }

      .tooltexx-smart-compressor .compressor-preview-wrap {
        text-align: center;
        overflow: hidden;
        border-radius: 14px;
        background: rgba(0,0,0,.04);
        padding: 10px;
      }

      .tooltexx-smart-compressor .compressor-preview-wrap img {
        display: block;
        max-width: 100%;
        max-height: 500px;
        margin: 0 auto;
        object-fit: contain;
        border-radius: 10px;
      }

      .tooltexx-smart-compressor .compressor-target-message {
        margin-top: 14px;
        padding: 12px;
        border-radius: 12px;
        font-size: 14px;
      }

      .tooltexx-smart-compressor .compressor-target-message.success {
        background: rgba(40, 170, 90, .10);
      }

      .tooltexx-smart-compressor .compressor-target-message.warning {
        background: rgba(230, 150, 30, .12);
      }

      .tooltexx-smart-compressor .download-link {
        display: block;
        text-align: center;
        margin-top: 16px;
      }

      @media (max-width: 600px) {

        .tooltexx-smart-compressor .compressor-info-card,
        .tooltexx-smart-compressor .compressor-result-grid {
          grid-template-columns: 1fr;
        }

        .tooltexx-smart-compressor .compressor-upload-box {
          padding: 18px 12px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /*
    Initialize control visibility for the default mode ("balanced")
    and default format (JPG) on first render.
  */
  updateFormatVisibility();
}


/* =========================================================
   IMAGE RESIZER
========================================================= */

function buildImageSizeWorkspace(key){
workspace.innerHTML=
'<div class="upload-zone" id="uploadZone">'+
'<label class="choose-file" for="fileInput">Select Image</label>'+
'<input type="file" id="fileInput" accept="image/*" hidden>'+
'<span class="hint-text">Maximum file size: '+MAX_IMAGE_MB+'MB</span>'+
'</div>'+
'<div id="imageControls" style="display:none">'+
'<div class="field-row"><label>Quality (<span id="qualityValue">75</span>%)</label><input type="range" id="qualityRange" min="10" max="100" value="75"></div>'+
(key==="image-resizer"?'<div class="field-row"><label>Width (px)</label><input type="number" id="widthInput" min="1"></div>':'')+
'</div>'+
'<button class="process-button" id="processButton" style="display:none">Process Image</button>'+
'<div id="toolStatus" class="status-msg" role="status" aria-live="polite"></div>'+
'<div id="resultArea" class="result-area"></div>';

var uploadZone=document.getElementById("uploadZone");
var fileInput=document.getElementById("fileInput");
var processButton=document.getElementById("processButton");
var statusEl=document.getElementById("toolStatus");
var resultArea=document.getElementById("resultArea");
var controls=document.getElementById("imageControls");
var qualityRange=document.getElementById("qualityRange");
var qualityValue=document.getElementById("qualityValue");
var widthInput=document.getElementById("widthInput");

var currentImg=null;
var currentFileName="image.jpg";

qualityRange.addEventListener("input",function(){qualityValue.textContent=this.value;});

function handleFile(file){
if(!file)return;
if(file.size>MAX_IMAGE_MB*1024*1024){
setStatus(statusEl,"This image is larger than "+MAX_IMAGE_MB+"MB.","error");
return;
}
loadImageFromFile(file).then(function(img){
currentImg=img;
currentFileName=file.name;
if(widthInput)widthInput.value=img.width;
controls.style.display="block";
processButton.style.display="block";
setStatus(statusEl,"","");
clearResultArea(resultArea);
/* img.src (a blob: URL) is only used to decode pixels into the Image
   object above; nothing displays it on screen, so it's safe to free
   it immediately instead of holding it until the page unloads. */
if(img.src && img.src.indexOf("blob:")===0){URL.revokeObjectURL(img.src);}
}).catch(function(err){setStatus(statusEl,err.message,"error");});
}

fileInput.addEventListener("change",function(){handleFile(this.files[0]);});
uploadZone.addEventListener("dragover",function(e){e.preventDefault();});
uploadZone.addEventListener("drop",function(e){
e.preventDefault();
if(e.dataTransfer.files.length){fileInput.files=e.dataTransfer.files;handleFile(e.dataTransfer.files[0]);}
});

processButton.addEventListener("click",function(){
if(!currentImg)return;
var quality=parseInt(qualityRange.value,10)/100;
var width=currentImg.width;
if(widthInput){var w=parseInt(widthInput.value,10);if(w&&w>0)width=w;}
var scale=width/currentImg.width;
var height=Math.max(1,Math.round(currentImg.height*scale));
var canvas=document.createElement("canvas");
canvas.width=width;canvas.height=height;
var ctx=canvas.getContext("2d");
ctx.fillStyle="#ffffff";ctx.fillRect(0,0,width,height);
ctx.drawImage(currentImg,0,0,width,height);
canvas.toBlob(function(blob){
if(!blob){setStatus(statusEl,"Image processing failed.","error");return;}
var filename=toolTexxOutputName(currentFileName,"jpg");
setStatus(statusEl,"Image processed successfully.","success");
clearResultArea(resultArea);
resultArea.appendChild(createDownloadLink(blob,filename));
},"image/jpeg",quality);
});
}

/* =========================================================
   IMAGE CROPPER
========================================================= */

function buildCropWorkspace(){
workspace.innerHTML=
'<div class="upload-zone" id="uploadZone">'+
'<label class="choose-file" for="fileInput">Select Image</label>'+
'<input type="file" id="fileInput" accept="image/*" hidden>'+
'<span class="hint-text">Maximum file size: '+MAX_IMAGE_MB+'MB</span>'+
'</div>'+
'<div id="cropContainer" style="display:none;margin-top:14px">'+
'<div style="position:relative;border-radius:14px;overflow:hidden;border:1px solid var(--border)" id="cropStage">'+
'<img id="cropImg" style="display:block;max-width:100%;user-select:none;pointer-events:none">'+
'<div id="cropBox" style="position:absolute;border:2px dashed var(--purple);background:rgba(124,58,237,.12);cursor:move"></div>'+
'</div>'+
'<p class="hint-text">Drag the box to select the crop area, then press Crop.</p>'+
'</div>'+
'<button class="process-button" id="processButton" style="display:none">Crop Image</button>'+
'<div id="toolStatus" class="status-msg" role="status" aria-live="polite"></div>'+
'<div id="resultArea" class="result-area"></div>';

var uploadZone=document.getElementById("uploadZone");
var fileInput=document.getElementById("fileInput");
var processButton=document.getElementById("processButton");
var statusEl=document.getElementById("toolStatus");
var resultArea=document.getElementById("resultArea");
var cropContainer=document.getElementById("cropContainer");
var cropStage=document.getElementById("cropStage");
var cropImg=document.getElementById("cropImg");
var cropBox=document.getElementById("cropBox");

var currentImg=null;
var currentFileName="image.png";
var currentPreviewUrl=null;
var box={x:20,y:20,w:150,h:150};
var dragging=false;
var dragStart={x:0,y:0};

function renderBox(){
cropBox.style.left=box.x+"px";cropBox.style.top=box.y+"px";
cropBox.style.width=box.w+"px";cropBox.style.height=box.h+"px";
}

function handleFile(file){
if(!file)return;
if(file.size>MAX_IMAGE_MB*1024*1024){setStatus(statusEl,"This image is larger than "+MAX_IMAGE_MB+"MB.","error");return;}
loadImageFromFile(file).then(function(img){
currentImg=img;
currentFileName=file.name;
/* Free the previous file's preview URL now that it's being replaced;
   the new one stays alive as long as it's shown in cropImg. */
if(currentPreviewUrl && currentPreviewUrl.indexOf("blob:")===0){URL.revokeObjectURL(currentPreviewUrl);}
currentPreviewUrl=img.src;
cropImg.src=img.src;
cropContainer.style.display="block";
processButton.style.display="block";
setStatus(statusEl,"","");clearResultArea(resultArea);
setTimeout(function(){
var sw=cropStage.clientWidth,sh=cropStage.clientHeight;
box={x:sw*0.15,y:sh*0.15,w:sw*0.7,h:sh*0.7};
renderBox();
},60);
}).catch(function(err){setStatus(statusEl,err.message,"error");});
}

fileInput.addEventListener("change",function(){handleFile(this.files[0]);});
uploadZone.addEventListener("dragover",function(e){e.preventDefault();});
uploadZone.addEventListener("drop",function(e){
e.preventDefault();
if(e.dataTransfer.files.length){fileInput.files=e.dataTransfer.files;handleFile(e.dataTransfer.files[0]);}
});

function pointerDown(e){
dragging=true;
var p=e.touches?e.touches[0]:e;
dragStart={x:p.clientX-box.x,y:p.clientY-box.y};
}
function pointerMove(e){
if(!dragging)return;
var p=e.touches?e.touches[0]:e;
var sw=cropStage.clientWidth,sh=cropStage.clientHeight;
box.x=Math.max(0,Math.min(p.clientX-dragStart.x,sw-box.w));
box.y=Math.max(0,Math.min(p.clientY-dragStart.y,sh-box.h));
renderBox();
e.preventDefault();
}
function pointerUp(){dragging=false;}

cropBox.addEventListener("mousedown",pointerDown);
document.addEventListener("mousemove",pointerMove);
document.addEventListener("mouseup",pointerUp);
cropBox.addEventListener("touchstart",pointerDown,{passive:true});
document.addEventListener("touchmove",pointerMove,{passive:false});
document.addEventListener("touchend",pointerUp);

processButton.addEventListener("click",function(){
if(!currentImg)return;
var sw=cropStage.clientWidth,sh=cropStage.clientHeight;
var scaleX=currentImg.width/sw,scaleY=currentImg.height/sh;
var sx=box.x*scaleX,sy=box.y*scaleY,sww=box.w*scaleX,shh=box.h*scaleY;
var canvas=document.createElement("canvas");
canvas.width=sww;canvas.height=shh;
var ctx=canvas.getContext("2d");
ctx.drawImage(currentImg,sx,sy,sww,shh,0,0,sww,shh);
canvas.toBlob(function(blob){
if(!blob){setStatus(statusEl,"Crop failed.","error");return;}
setStatus(statusEl,"Image cropped successfully.","success");
clearResultArea(resultArea);
resultArea.appendChild(createDownloadLink(blob,toolTexxOutputName(currentFileName,"png")));
},"image/png");
});
}


/* =========================================================
   AUDIO HELPERS
========================================================= */

function decodeAudioFile(file){
return file.arrayBuffer().then(function(buf){
var AudioCtx=window.AudioContext||window.webkitAudioContext;
if(!AudioCtx){throw new Error("Audio decoding is not supported in this browser.");}
var ctx=new AudioCtx();
return ctx.decodeAudioData(buf);
});
}

function floatTo16BitPCM(input){
var output=new Int16Array(input.length);
for(var i=0;i<input.length;i++){
var s=Math.max(-1,Math.min(1,input[i]));
output[i]=s<0?s*0x8000:s*0x7FFF;
}
return output;
}

function encodeMp3FromAudioBuffer(audioBuffer,kbps){
if(typeof lamejs==="undefined"){throw new Error("MP3 encoder library is unavailable. Please refresh the page.");}
var channels=audioBuffer.numberOfChannels>=2?2:1;
var sampleRate=audioBuffer.sampleRate;
var mp3encoder=new lamejs.Mp3Encoder(channels,sampleRate,kbps);
var left=floatTo16BitPCM(audioBuffer.getChannelData(0));
var right=channels===2?floatTo16BitPCM(audioBuffer.getChannelData(1)):null;
var blockSize=1152;
var mp3Data=[];
for(var i=0;i<left.length;i+=blockSize){
var leftChunk=left.subarray(i,i+blockSize);
var mp3buf;
if(channels===2){
var rightChunk=right.subarray(i,i+blockSize);
mp3buf=mp3encoder.encodeBuffer(leftChunk,rightChunk);
}else{
mp3buf=mp3encoder.encodeBuffer(leftChunk);
}
if(mp3buf.length>0)mp3Data.push(new Int8Array(mp3buf));
}
var end=mp3encoder.flush();
if(end.length>0)mp3Data.push(new Int8Array(end));
return new Blob(mp3Data,{type:"audio/mp3"});
}

function interleaveChannels(left,right){
var length=left.length+right.length;
var result=new Float32Array(length);
var index=0,inputIndex=0;
while(index<length){
result[index++]=left[inputIndex];
result[index++]=right[inputIndex];
inputIndex++;
}
return result;
}

function encodeWAVBlob(samples,sampleRate,numChannels){
var bytesPerSample=2;
var blockAlign=numChannels*bytesPerSample;
var buffer=new ArrayBuffer(44+samples.length*bytesPerSample);
var view=new DataView(buffer);

function writeString(offset,string){
for(var i=0;i<string.length;i++)view.setUint8(offset+i,string.charCodeAt(i));
}

writeString(0,"RIFF");
view.setUint32(4,36+samples.length*bytesPerSample,true);
writeString(8,"WAVE");
writeString(12,"fmt ");
view.setUint32(16,16,true);
view.setUint16(20,1,true);
view.setUint16(22,numChannels,true);
view.setUint32(24,sampleRate,true);
view.setUint32(28,sampleRate*blockAlign,true);
view.setUint16(32,blockAlign,true);
view.setUint16(34,16,true);
writeString(36,"data");
view.setUint32(40,samples.length*bytesPerSample,true);

var offset=44;
for(var i=0;i<samples.length;i++,offset+=2){
var s=Math.max(-1,Math.min(1,samples[i]));
view.setInt16(offset,s<0?s*0x8000:s*0x7FFF,true);
}

return new Blob([view],{type:"audio/wav"});
}

function audioBufferToWavBlob(buffer){
var numChannels=buffer.numberOfChannels;
var samples;
if(numChannels>=2){
samples=interleaveChannels(buffer.getChannelData(0),buffer.getChannelData(1));
numChannels=2;
}else{
samples=buffer.getChannelData(0);
numChannels=1;
}
return encodeWAVBlob(samples,buffer.sampleRate,numChannels);
}

/* =========================================================
   MUSIC CONVERTER
========================================================= */

function buildMusicConverterWorkspace(){
workspace.innerHTML=
'<div class="upload-zone" id="uploadZone">'+
'<label class="choose-file" for="fileInput">Select Audio File</label>'+
'<input type="file" id="fileInput" accept="audio/*" hidden>'+
'<span class="hint-text">MP3, WAV, M4A, OGG supported. Maximum '+MAX_AUDIO_MB+'MB.</span>'+
'</div>'+
'<div id="selectedFile" class="selected-file"></div>'+
'<div class="field-row"><label>Convert To</label><select id="targetFormat"><option value="mp3">MP3</option><option value="wav">WAV</option></select></div>'+
'<div class="field-row" id="bitrateRow"><label>MP3 Quality</label><select id="bitrateSelect">'+
'<option value="128">128 kbps (Standard)</option>'+
'<option value="192">192 kbps (Good)</option>'+
'<option value="320">320 kbps (Best)</option>'+
'</select></div>'+
'<button class="process-button" id="processButton">Convert</button>'+
'<div id="toolStatus" class="status-msg" role="status" aria-live="polite"></div>'+
'<div id="resultArea" class="result-area"></div>';

var uploadZone=document.getElementById("uploadZone");
var fileInput=document.getElementById("fileInput");
var selectedFile=document.getElementById("selectedFile");
var targetFormat=document.getElementById("targetFormat");
var bitrateRow=document.getElementById("bitrateRow");
var bitrateSelect=document.getElementById("bitrateSelect");
var processButton=document.getElementById("processButton");
var statusEl=document.getElementById("toolStatus");
var resultArea=document.getElementById("resultArea");

var currentFile=null;

targetFormat.addEventListener("change",function(){
bitrateRow.style.display=this.value==="mp3"?"flex":"none";
});

function showFile(file){
if(!file)return;
if(file.size>MAX_AUDIO_MB*1024*1024){
setStatus(statusEl,"This file is larger than "+MAX_AUDIO_MB+"MB.","error");
return;
}
currentFile=file;
selectedFile.innerHTML="<strong>"+escapeHTML(file.name)+"</strong><br>"+formatFileSize(file.size);
selectedFile.classList.add("show");
setStatus(statusEl,"","");
clearResultArea(resultArea);
}

fileInput.addEventListener("change",function(){showFile(this.files[0]);});
uploadZone.addEventListener("dragover",function(e){e.preventDefault();});
uploadZone.addEventListener("drop",function(e){
e.preventDefault();
if(e.dataTransfer.files.length){fileInput.files=e.dataTransfer.files;showFile(e.dataTransfer.files[0]);}
});

processButton.addEventListener("click",function(){
if(!currentFile){setStatus(statusEl,"Please select an audio file first.","error");return;}
processButton.disabled=true;
var format=targetFormat.value;
setStatus(statusEl,"Loading, please wait...","");
clearResultArea(resultArea);

Promise.resolve()
.then(function(){return format==="mp3"?loadLibrary("lamejs"):null;})
.then(function(){
setStatus(statusEl,"Decoding audio, please wait...","");
return decodeAudioFile(currentFile);
}).then(function(audioBuffer){
setStatus(statusEl,"Encoding, please wait...","");
if(format==="wav"){
var blob=audioBufferToWavBlob(audioBuffer);
setStatus(statusEl,"Converted successfully.","success");
resultArea.appendChild(createDownloadLink(blob,toolTexxOutputName(currentFile.name,"wav")));
}else{
var kbps=parseInt(bitrateSelect.value,10);
var blob2=encodeMp3FromAudioBuffer(audioBuffer,kbps);
setStatus(statusEl,"Converted successfully.","success");
resultArea.appendChild(createDownloadLink(blob2,toolTexxOutputName(currentFile.name,"mp3")));
}
processButton.disabled=false;
}).catch(function(err){
setStatus(statusEl,"Conversion failed: "+(err&&err.message?err.message:"This audio format could not be decoded by your browser."),"error");
processButton.disabled=false;
});
});
}

/* =========================================================
   MUSIC COMPRESSOR
========================================================= */

function buildMusicCompressorWorkspace(){
workspace.innerHTML=
'<div class="upload-zone" id="uploadZone">'+
'<label class="choose-file" for="fileInput">Select Audio File</label>'+
'<input type="file" id="fileInput" accept="audio/*" hidden>'+
'<span class="hint-text">MP3, WAV, M4A, OGG supported. Maximum '+MAX_AUDIO_MB+'MB.</span>'+
'</div>'+
'<div id="selectedFile" class="selected-file"></div>'+
'<div class="field-row"><label>Output Quality (lower = smaller file)</label><select id="bitrateSelect">'+
'<option value="64">64 kbps (Smallest)</option>'+
'<option value="96">96 kbps (Small)</option>'+
'<option value="128" selected>128 kbps (Balanced)</option>'+
'<option value="192">192 kbps (Higher Quality)</option>'+
'</select></div>'+
'<button class="process-button" id="processButton">Compress</button>'+
'<div id="toolStatus" class="status-msg" role="status" aria-live="polite"></div>'+
'<div id="resultArea" class="result-area"></div>';

var uploadZone=document.getElementById("uploadZone");
var fileInput=document.getElementById("fileInput");
var selectedFile=document.getElementById("selectedFile");
var bitrateSelect=document.getElementById("bitrateSelect");
var processButton=document.getElementById("processButton");
var statusEl=document.getElementById("toolStatus");
var resultArea=document.getElementById("resultArea");

var currentFile=null;

function showFile(file){
if(!file)return;
if(file.size>MAX_AUDIO_MB*1024*1024){
setStatus(statusEl,"This file is larger than "+MAX_AUDIO_MB+"MB.","error");
return;
}
currentFile=file;
selectedFile.innerHTML="<strong>"+escapeHTML(file.name)+"</strong><br>Original size: "+formatFileSize(file.size);
selectedFile.classList.add("show");
setStatus(statusEl,"","");
clearResultArea(resultArea);
}

fileInput.addEventListener("change",function(){showFile(this.files[0]);});
uploadZone.addEventListener("dragover",function(e){e.preventDefault();});
uploadZone.addEventListener("drop",function(e){
e.preventDefault();
if(e.dataTransfer.files.length){fileInput.files=e.dataTransfer.files;showFile(e.dataTransfer.files[0]);}
});

processButton.addEventListener("click",function(){
if(!currentFile){setStatus(statusEl,"Please select an audio file first.","error");return;}
processButton.disabled=true;
setStatus(statusEl,"Loading, please wait...","");
clearResultArea(resultArea);

var originalSize=currentFile.size;

loadLibrary("lamejs").then(function(){
setStatus(statusEl,"Decoding audio, please wait...","");
return decodeAudioFile(currentFile);
}).then(function(audioBuffer){
setStatus(statusEl,"Compressing, please wait...","");
var kbps=parseInt(bitrateSelect.value,10);
var blob=encodeMp3FromAudioBuffer(audioBuffer,kbps);
var savedPct=Math.max(0,Math.round((1-(blob.size/originalSize))*100));
setStatus(statusEl,"Compressed successfully. New size: "+formatFileSize(blob.size)+" (about "+savedPct+"% smaller).","success");
resultArea.appendChild(createDownloadLink(blob,toolTexxOutputName(currentFile.name,"mp3")));
processButton.disabled=false;
}).catch(function(err){
setStatus(statusEl,"Compression failed: "+(err&&err.message?err.message:"This audio format could not be decoded by your browser."),"error");
processButton.disabled=false;
});
});
}


/* =========================================================
   WORD COUNTER
========================================================= */

function buildWordCounterWorkspace(){
workspace.innerHTML=
'<textarea id="ttInput" class="tool-textarea" placeholder="Paste or type your text here..."></textarea>'+
'<div id="ttStats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px"></div>';

var input=document.getElementById("ttInput");
var statsBox=document.getElementById("ttStats");

function update(){
var text=input.value;
var words=text.trim()?text.trim().split(/\s+/).length:0;
var characters=text.length;
var lines=text?text.split("\n").length:0;
var stats=[["Words",words],["Characters",characters],["Lines",lines]];
statsBox.innerHTML=stats.map(function(s){
return '<div style="padding:14px;border-radius:12px;background:var(--bg);text-align:center"><strong style="display:block;font-size:20px;color:var(--purple-dark)">'+s[1]+'</strong><span style="font-size:11px;color:var(--muted)">'+s[0]+'</span></div>';
}).join("");
}
input.addEventListener("input",update);
update();
}

/* =========================================================
   CASE CONVERTER
========================================================= */

function buildCaseConverterWorkspace(){
workspace.innerHTML=
'<textarea id="ttInput" class="tool-textarea" placeholder="Type or paste your text here..."></textarea>'+
'<div class="field-row"><label>Mode</label><select id="ttMode">'+
'<option value="upper">UPPERCASE</option>'+
'<option value="lower">lowercase</option>'+
'<option value="title">Title Case</option>'+
'<option value="sentence">Sentence case</option>'+
'</select></div>'+
'<textarea id="ttOutput" class="tool-textarea" readonly placeholder="Result will appear here..."></textarea>'+
'<div class="workspace-actions"><button class="btn-secondary" id="ttCopy">Copy Result</button></div>'+
'<div id="toolStatus" class="status-msg" role="status" aria-live="polite"></div>';

var input=document.getElementById("ttInput");
var mode=document.getElementById("ttMode");
var output=document.getElementById("ttOutput");
var statusEl=document.getElementById("toolStatus");

function transform(text,m){
if(m==="upper")return text.toUpperCase();
if(m==="lower")return text.toLowerCase();
if(m==="title")return text.replace(/\w\S*/g,function(w){return w.charAt(0).toUpperCase()+w.slice(1).toLowerCase();});
return text.toLowerCase().replace(/(^\s*\w)|([.!?]\s*\w)/g,function(c){return c.toUpperCase();});
}
function update(){output.value=transform(input.value,mode.value);}
input.addEventListener("input",update);
mode.addEventListener("change",update);
document.getElementById("ttCopy").addEventListener("click",function(){
if(!output.value)return;
navigator.clipboard.writeText(output.value).then(function(){setStatus(statusEl,"Copied to clipboard.","success");}).catch(function(){output.select();});
});
}

/* =========================================================
   JSON FORMATTER
========================================================= */

function buildJsonFormatterWorkspace(){
workspace.innerHTML=
'<textarea id="ttInput" class="tool-textarea" placeholder=\'Paste JSON, e.g. {"name":"ToolTexx"}\'></textarea>'+
'<div class="field-row"><label>Mode</label><select id="ttMode">'+
'<option value="pretty">Pretty Print</option>'+
'<option value="minify">Minify</option>'+
'</select></div>'+
'<textarea id="ttOutput" class="tool-textarea" readonly placeholder="Result will appear here..."></textarea>'+
'<div class="workspace-actions"><button class="btn-secondary" id="ttCopy">Copy Result</button></div>'+
'<div id="toolStatus" class="status-msg" role="status" aria-live="polite"></div>';

var input=document.getElementById("ttInput");
var mode=document.getElementById("ttMode");
var output=document.getElementById("ttOutput");
var statusEl=document.getElementById("toolStatus");

function update(){
try{
var parsed=JSON.parse(input.value);
output.value=mode.value==="minify"?JSON.stringify(parsed):JSON.stringify(parsed,null,2);
setStatus(statusEl,"","");
}catch(e){
output.value="";
if(input.value.trim())setStatus(statusEl,"Invalid JSON: "+e.message,"error");
else setStatus(statusEl,"","");
}
}
input.addEventListener("input",update);
mode.addEventListener("change",update);
document.getElementById("ttCopy").addEventListener("click",function(){
if(!output.value)return;
navigator.clipboard.writeText(output.value).then(function(){setStatus(statusEl,"Copied to clipboard.","success");}).catch(function(){output.select();});
});
}

/* =========================================================
   BASE64 ENCODER
========================================================= */

function buildBase64Workspace(){
workspace.innerHTML=
'<textarea id="ttInput" class="tool-textarea" placeholder="Type text, or switch mode and paste Base64..."></textarea>'+
'<div class="field-row"><label>Mode</label><select id="ttMode">'+
'<option value="encode">Encode</option>'+
'<option value="decode">Decode</option>'+
'</select></div>'+
'<textarea id="ttOutput" class="tool-textarea" readonly placeholder="Result will appear here..."></textarea>'+
'<div class="workspace-actions"><button class="btn-secondary" id="ttCopy">Copy Result</button></div>'+
'<div id="toolStatus" class="status-msg" role="status" aria-live="polite"></div>';

var input=document.getElementById("ttInput");
var mode=document.getElementById("ttMode");
var output=document.getElementById("ttOutput");
var statusEl=document.getElementById("toolStatus");

function update(){
try{
if(mode.value==="decode"){
output.value=input.value.trim()?decodeURIComponent(escape(window.atob(input.value.trim()))):"";
}else{
output.value=window.btoa(unescape(encodeURIComponent(input.value)));
}
setStatus(statusEl,"","");
}catch(e){
output.value="";
if(input.value.trim())setStatus(statusEl,"This is not valid Base64 text.","error");
}
}
input.addEventListener("input",update);
mode.addEventListener("change",update);
document.getElementById("ttCopy").addEventListener("click",function(){
if(!output.value)return;
navigator.clipboard.writeText(output.value).then(function(){setStatus(statusEl,"Copied to clipboard.","success");}).catch(function(){output.select();});
});
}

/* =========================================================
   QR GENERATOR
========================================================= */

function buildQrWorkspace(){
workspace.innerHTML=
'<textarea id="qrText" class="tool-textarea" placeholder="Enter text, a website URL or any information..." maxlength="2000"></textarea>'+
'<div class="workspace-actions"><button class="process-button" id="processButton" style="margin-top:0">Generate QR Code</button><button class="btn-secondary" id="qrClear">Clear</button></div>'+
'<div id="toolStatus" class="status-msg" role="status" aria-live="polite"></div>'+
'<div id="resultArea" class="result-area"></div>';

var textInput=document.getElementById("qrText");
var button=document.getElementById("processButton");
var statusEl=document.getElementById("toolStatus");
var resultArea=document.getElementById("resultArea");

button.addEventListener("click",function(){
var text=textInput.value.trim();
clearResultArea(resultArea);
if(!text){setStatus(statusEl,"Please enter text or a URL first.","error");return;}
button.disabled=true;
setStatus(statusEl,"Loading, please wait...","");
loadLibrary("qrcode").then(function(){
if(typeof window.QRCode==="undefined"){setStatus(statusEl,"QR library could not be loaded. Please refresh the page.","error");button.disabled=false;return;}
setStatus(statusEl,"","");

var wrap=document.createElement("div");
wrap.className="qr-preview";
var box=document.createElement("div");
box.className="qr-preview-box";
wrap.appendChild(box);
resultArea.appendChild(wrap);

try{
new window.QRCode(box,{text:text,width:200,height:200,colorDark:"#171723",colorLight:"#ffffff",correctLevel:window.QRCode.CorrectLevel.H});
setTimeout(function(){
var canvas=box.querySelector("canvas");
var image=box.querySelector("img");
var dataURL=canvas?canvas.toDataURL("image/png"):(image?image.src:"");
if(!dataURL){setStatus(statusEl,"QR code could not be generated. Please try again.","error");button.disabled=false;return;}
var download=document.createElement("a");
download.href=dataURL;download.download="ToolTexx-QR-Code.png";
download.className="download-link";download.textContent="Download QR Code";
wrap.appendChild(download);
setStatus(statusEl,"QR code generated successfully.","success");
button.disabled=false;
},500);
}catch(error){setStatus(statusEl,"QR generation failed: "+error.message,"error");button.disabled=false;}
}).catch(function(error){
setStatus(statusEl,error&&error.message?error.message:"QR library could not be loaded.","error");
button.disabled=false;
});
});

document.getElementById("qrClear").addEventListener("click",function(){
textInput.value="";clearResultArea(resultArea);setStatus(statusEl,"","");
});
}

/* =========================================================
   PASSWORD GENERATOR
========================================================= */

function buildPasswordWorkspace(){
workspace.innerHTML=
'<input type="text" id="pwOutput" class="password-output" readonly placeholder="Your password will appear here">'+
'<div class="field-row"><label>Length (<span id="pwLengthValue">16</span>)</label><input type="range" id="pwLength" min="6" max="64" value="16"></div>'+
'<div class="checkbox-row"><input type="checkbox" id="pwUpper" checked><label for="pwUpper">Uppercase Letters</label></div>'+
'<div class="checkbox-row"><input type="checkbox" id="pwLower" checked><label for="pwLower">Lowercase Letters</label></div>'+
'<div class="checkbox-row"><input type="checkbox" id="pwNumbers" checked><label for="pwNumbers">Numbers</label></div>'+
'<div class="checkbox-row"><input type="checkbox" id="pwSymbols"><label for="pwSymbols">Symbols</label></div>'+
'<div class="workspace-actions"><button class="process-button" id="processButton" style="margin-top:0">Generate Password</button><button class="btn-secondary" id="pwCopy">Copy</button></div>'+
'<div id="toolStatus" class="status-msg" role="status" aria-live="polite"></div>';

var output=document.getElementById("pwOutput");
var lengthRange=document.getElementById("pwLength");
var lengthValue=document.getElementById("pwLengthValue");
var button=document.getElementById("processButton");
var statusEl=document.getElementById("toolStatus");

lengthRange.addEventListener("input",function(){lengthValue.textContent=this.value;});

button.addEventListener("click",function(){
var length=parseInt(lengthRange.value,10);
var upper=document.getElementById("pwUpper").checked;
var lower=document.getElementById("pwLower").checked;
var numbers=document.getElementById("pwNumbers").checked;
var symbols=document.getElementById("pwSymbols").checked;
var chars="";
if(upper)chars+="ABCDEFGHJKLMNPQRSTUVWXYZ";
if(lower)chars+="abcdefghijkmnpqrstuvwxyz";
if(numbers)chars+="23456789";
if(symbols)chars+="!@#$%^&*()-_=+[]{}";
if(!chars){setStatus(statusEl,"Select at least one character type.","error");return;}
var array=new Uint32Array(length);
crypto.getRandomValues(array);
var pass="";
for(var i=0;i<length;i++){pass+=chars[array[i]%chars.length];}
output.value=pass;
setStatus(statusEl,"Password generated.","success");
});

document.getElementById("pwCopy").addEventListener("click",function(){
if(!output.value)return;
navigator.clipboard.writeText(output.value).then(function(){setStatus(document.getElementById("toolStatus"),"Copied to clipboard.","success");}).catch(function(){output.select();});
});
}

/* =========================================================
   UNIT CONVERTER
========================================================= */

var UNIT_DATA={
length:{units:{meter:{label:"Meters",factor:1},kilometer:{label:"Kilometers",factor:1000},centimeter:{label:"Centimeters",factor:0.01},millimeter:{label:"Millimeters",factor:0.001},mile:{label:"Miles",factor:1609.34},yard:{label:"Yards",factor:0.9144},foot:{label:"Feet",factor:0.3048},inch:{label:"Inches",factor:0.0254}}},
weight:{units:{kilogram:{label:"Kilograms",factor:1},gram:{label:"Grams",factor:0.001},milligram:{label:"Milligrams",factor:0.000001},pound:{label:"Pounds",factor:0.453592},ounce:{label:"Ounces",factor:0.0283495},tonne:{label:"Tonnes",factor:1000}}},
temperature:{units:{celsius:{label:"Celsius"},fahrenheit:{label:"Fahrenheit"},kelvin:{label:"Kelvin"}}}
};

function convertUnitValue(category,value,from,to){
if(category==="temperature"){
var celsius;
if(from==="celsius")celsius=value;
else if(from==="fahrenheit")celsius=(value-32)*5/9;
else celsius=value-273.15;
if(to==="celsius")return celsius;
if(to==="fahrenheit")return celsius*9/5+32;
return celsius+273.15;
}
var data=UNIT_DATA[category].units;
return (value*data[from].factor)/data[to].factor;
}

function buildUnitWorkspace(){
workspace.innerHTML=
'<div class="field-row"><label>Category</label><select id="unitCategory"><option value="length">Length</option><option value="weight">Weight</option><option value="temperature">Temperature</option></select></div>'+
'<div class="field-row"><label>Value</label><input type="number" id="unitValue" value="1"></div>'+
'<div class="field-row"><label>From</label><select id="unitFrom"></select></div>'+
'<div class="field-row"><label>To</label><select id="unitTo"></select></div>'+
'<button class="process-button" id="processButton">Convert</button>'+
'<div id="toolStatus" class="status-msg" role="status" aria-live="polite"></div>';

var categorySelect=document.getElementById("unitCategory");
var valueInput=document.getElementById("unitValue");
var fromSelect=document.getElementById("unitFrom");
var toSelect=document.getElementById("unitTo");
var button=document.getElementById("processButton");
var statusEl=document.getElementById("toolStatus");

function populateUnits(){
var category=categorySelect.value;
var units=UNIT_DATA[category].units;
var optionsHtml="";
Object.keys(units).forEach(function(key){optionsHtml+='<option value="'+key+'">'+units[key].label+'</option>';});
fromSelect.innerHTML=optionsHtml;toSelect.innerHTML=optionsHtml;
var keys=Object.keys(units);
if(keys.length>1)toSelect.selectedIndex=1;
}
categorySelect.addEventListener("change",populateUnits);
populateUnits();

button.addEventListener("click",function(){
var category=categorySelect.value;
var value=parseFloat(valueInput.value);
if(isNaN(value)){setStatus(statusEl,"Enter a valid number.","error");return;}
var result=convertUnitValue(category,value,fromSelect.value,toSelect.value);
setStatus(statusEl,value+" "+fromSelect.options[fromSelect.selectedIndex].text+" = "+(Math.round(result*10000)/10000)+" "+toSelect.options[toSelect.selectedIndex].text,"success");
});
}

/* =========================================================
   CALCULATOR
========================================================= */

/* Safe arithmetic evaluator: no eval/Function. Supports + - * / and decimals
   with standard operator precedence, via a small recursive-descent parser. */
function safeEvalArithmetic(expr){
var pos=0;
function peek(){return expr[pos];}
function isDigit(c){return c>=String.fromCharCode(48)&&c<=String.fromCharCode(57);}
function parseNumber(){
var start=pos;
while(pos<expr.length&&(isDigit(peek())||peek()===".")){pos++;}
if(pos===start)throw new Error("Invalid expression");
return parseFloat(expr.slice(start,pos));
}
function parseUnary(){
if(peek()==="-"){pos++;return -parseUnary();}
if(peek()==="+"){pos++;return parseUnary();}
return parseNumber();
}
function parseTerm(){
var value=parseUnary();
while(peek()==="*"||peek()==="/"){
var op=peek();pos++;
var rhs=parseUnary();
if(op==="*"){value=value*rhs;}
else{
if(rhs===0)throw new Error("Cannot divide by zero");
value=value/rhs;
}
}
return value;
}
function parseExpr(){
var value=parseTerm();
while(peek()==="+"||peek()==="-"){
var op=peek();pos++;
var rhs=parseTerm();
value=op==="+"?value+rhs:value-rhs;
}
return value;
}
var result=parseExpr();
if(pos!==expr.length)throw new Error("Invalid expression");
if(!isFinite(result))throw new Error("Invalid result");
return result;
}

function buildCalculatorWorkspace(){
var keys=["7","8","9","/","4","5","6","*","1","2","3","-","0",".","=","+","C"];
var keysHtml=keys.map(function(k){
var cls="calc-key";
if("+-*/".indexOf(k)>-1)cls+=" op";
if(k==="=")cls+=" equals";
return '<button class="'+cls+'" data-key="'+k+'">'+k+'</button>';
}).join("");

workspace.innerHTML='<div class="calc-display" id="calcDisplay">0</div><div class="calc-grid">'+keysHtml+'</div>';

var display=document.getElementById("calcDisplay");
var expression="";
function updateDisplay(){display.textContent=expression||"0";}

workspace.querySelectorAll(".calc-key").forEach(function(btn){
btn.addEventListener("click",function(){
var key=this.dataset.key;
if(key==="C"){expression="";updateDisplay();return;}
if(key==="="){
try{
if(!/^[0-9+\-*/.\s]+$/.test(expression)){throw new Error("Invalid expression");}
var result=safeEvalArithmetic(expression.replace(/\s+/g,""));
expression=String(Math.round(result*1000000)/1000000);
}catch(e){expression="Error";}
updateDisplay();return;
}
if(expression==="Error")expression="";
expression+=key;
updateDisplay();
});
});
updateDisplay();
}


/* =========================================================
   FEATURED: INSTANT PDF TO WORD (homepage top box)
========================================================= */

var featuredFileInput=document.getElementById("featuredFileInput");
var featuredStatus=document.getElementById("featuredStatus");
var featuredDownload=document.getElementById("featuredDownload");

if(featuredFileInput){
featuredFileInput.addEventListener("change",function(){
var file=this.files[0];
if(!file)return;

featuredDownload.style.display="none";
if(featuredDownload.href && featuredDownload.href.indexOf("blob:")===0){
URL.revokeObjectURL(featuredDownload.href);
}

if(file.size>MAX_PDF_MB*1024*1024){
setStatus(featuredStatus,"This PDF is larger than "+MAX_PDF_MB+"MB. Please choose a smaller file.","error");
return;
}

setStatus(featuredStatus,"Loading, please wait...","");

loadLibraries(["pdfjsLib","jszip"]).then(function(){
setStatus(featuredStatus,"Converting, please wait...","");
return extractPdfBlocks(file);
}).then(function(blocks){
return buildDocxFromBlocks(blocks);
}).then(function(blob){
var url=URL.createObjectURL(blob);
featuredDownload.href=url;
featuredDownload.download=toolTexxOutputName(file.name,"docx");
featuredDownload.style.display="block";
setStatus(featuredStatus,"Done! Tables, bold/italic text, headings, and images are reconstructed automatically; some formatting may still differ from the original.","success");
}).catch(function(error){
setStatus(featuredStatus,"Conversion failed: "+(error&&error.message?error.message:String(error)),"error");
});
});
}

/* =========================================================
   PWA: SERVICE WORKER REGISTRATION
========================================================= */

if("serviceWorker" in navigator){
window.addEventListener("load",function(){
navigator.serviceWorker.register("sw.js").catch(function(err){
console.warn("ToolTexx: service worker registration failed.",err);
});
});
}

window.openTool=openTool;

var autoToolKey=document.body.getAttribute("data-auto-tool");
if(autoToolKey && TOOL_INFO[autoToolKey]){
openTool(autoToolKey);
}

})();
