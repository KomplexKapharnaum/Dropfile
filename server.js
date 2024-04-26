const UPLOAD_DIR = '/srv/seafile-sync/Dropfile'
const UPLOAD_SIZE = 300 // MB

const express = require('express');
const http = require('http');
const bodyParser = require("body-parser");
const socketIO = require('socket.io');
const flmgr = require('@flmngr/flmngr-server-node-express');
const fs = require('fs');
const path = require('path');

// Multer
//
const multer  = require('multer')
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOAD_DIR)
    },
    filename: function (req, file, cb) {
        console.log(file);
        cb(null, file.originalname)
    }
})
const upload = multer({ 
    storage: storage,
    limits: { fileSize: UPLOAD_SIZE*1024*1024 }
 })

// Servers
//
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Limits
//
app.use(bodyParser.json({limit: UPLOAD_SIZE+'mb'})); 
app.use(bodyParser.urlencoded({extended:true, limit: UPLOAD_SIZE+'mb'})); 

// Socket.io
//
io.on('connection', (socket) => {
    console.log('A user connected');

    // Send projects list
    fs.readdir(UPLOAD_DIR, (err, files) => {
        if (err) {
            console.error(err);
            return;
        }
        const projects = files.filter(file => fs.statSync(path.join(UPLOAD_DIR, file)).isDirectory() 
                                                    && !file.startsWith('.') && !file.startsWith('_') 
                                                    && file.replace(/[^a-zA-Z0-9_]/g, '') == file);
        socket.emit('projects', projects);
        console.log(projects);
    });


    // Disconnection event
    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});


// // Serve the static files
app.use(express.static('www'));

// Serve the index
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/www/index.html');
})

// Serve Admin page
app.get('/admin', (req, res) => {
    res.sendFile(__dirname + '/www/admin.html');
})

// Upload files
app.post('/upload', upload.single('file'), (req, res) => {
    console.log(req.file);
    
    var project = null;
    var nick = null;
    if (req.body.project) project = req.body.project.replace(/ /g, '_').replace(/[^a-zA-Z0-9_]/g, '').substr(0, 20);
    if (req.body.nick) nick = req.body.nick.replace(/ /g, '_').replace(/[^a-zA-Z0-9_]/g, '').substr(0, 20);

    if (!project || !nick) {
        // remove uploaded file
        fs.unlinkSync(req.file.path)
        throw new Error('Missing project or nick');
    }

    project = path.join(UPLOAD_DIR, project);
    if (!fs.existsSync(project)) fs.mkdirSync(project);

    var filename = nick + '_' + new Date().getTime() + '_' + req.file.originalname.slice(-10);

    fs.renameSync(req.file.path, path.join(project, filename))
    
    res.send('OK');
})

// Filemanager
flmgr.bindFlmngr({
    app: app,
    urlFileManager: "/flmngr",
    urlFiles: "/files",
    dirFiles: UPLOAD_DIR
});


// Start the server
const port = process.env.PORT || 5000;
server.listen(port, () => {
    console.log(`Dropfile is running on port ${port}`);
});