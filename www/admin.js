import Flmngr from "https://cdn.skypack.dev/flmngr";

// FileManager
Flmngr.open({
    apiKey: "FLMNFLMN",
    urlFileManager: '/flmngr',
    urlFiles: '/files',
    
    isMultiple: null,
    acceptExtensions: null,
    showCloseButton: false,

    orderBy: "date",
    orderAsc: false,

    onFinish: null
}); 
