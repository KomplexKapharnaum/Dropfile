require('dotenv').config()

const upload_path = process.env.UPLOAD_PATH
const upload_size = process.env.UPLOAD_SIZE 
const front_port = process.env.FRONTEND_PORT
const browser_port = process.env.BROWSER_PORT

const proxy = require('express-http-proxy');
const express = require('express');
const http = require('http');
const bodyParser = require("body-parser");
const socketIO = require('socket.io');
const fs = require('fs');
const path = require('path');

// Multer
//
const multer  = require('multer')
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, upload_path)
    },
    filename: function (req, file, cb) {
        console.log(file);
        cb(null, file.originalname)
    }
})
const upload = multer({ 
    storage: storage,
    limits: { fileSize: upload_size*1024*1024 }
 })

// Servers
//
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Filebrowser
//
const { spawn } = require('child_process');
const filebrowser = spawn('filebrowser', [
                                '-p', browser_port, 
                                '-a', '127.0.0.1',
                                '-b', '/admin',
                                '-r', upload_path
                            ]);

app.use('/admin', proxy('http://127.0.0.1:'+browser_port, {
    parseReqBody: false,
    limit: upload_size + 'mb'
}));

// Limits
//
app.use(bodyParser.json({limit: upload_size+'mb'})); 
app.use(bodyParser.urlencoded({extended:true, limit: upload_size+'mb'})); 

// Socket.io
//
io.on('connection', (socket) => {
    console.log('A user connected');

    // Send projects list
    fs.readdir(upload_path, (err, files) => {
        if (err) {
            console.error(err);
            return;
        }
        var projects = files.filter(file => fs.statSync(path.join(upload_path, file)).isDirectory() 
                                                    && !file.startsWith('.') && !file.startsWith('_') 
                                                    && file.replace(/[^a-zA-Z0-9_]/g, '') == file);
        socket.emit('projects', projects);
        console.log(projects);
    });


    // Diaporama: join a folder room to receive new media events
    socket.on('diaporama-join', (folder) => {
        const safe = folder.replace(/[^a-zA-Z0-9_-]/g, '');
        socket.join('diaporama:' + safe);
        console.log('Diaporama joined room: ' + safe);
    });

    // Disconnection event
    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});


// // Serve the static files
app.use(express.static('www'));

// Serve uploaded media files for diaporama
app.use('/media', express.static(upload_path));

// Serve the index
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/www/index.html');
})

// Diaporama page
app.get('/diaporama', (req, res) => {
    res.sendFile(__dirname + '/www/diaporama.html');
})

// API: list folders
app.get('/api/folders', (req, res) => {
    fs.readdir(upload_path, (err, files) => {
        if (err) return res.status(500).json({ error: 'Cannot read upload path' });
        const folders = files.filter(file => {
            try {
                return fs.statSync(path.join(upload_path, file)).isDirectory()
                    && !file.startsWith('.') && !file.startsWith('_');
            } catch (e) { return false; }
        });
        res.json(folders);
    });
})

// API: list media in a folder
app.get('/api/media/:folder', (req, res) => {
    const folder = req.params.folder.replace(/[^a-zA-Z0-9_-]/g, '');
    const folderPath = path.join(upload_path, folder);
    
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
        return res.status(404).json({ error: 'Folder not found' });
    }

    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
    const videoExts = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv'];
    const allowedExts = [...imageExts, ...videoExts];

    fs.readdir(folderPath, (err, files) => {
        if (err) return res.status(500).json({ error: 'Cannot read folder' });
        const media = files
            .filter(f => !f.startsWith('.') && allowedExts.includes(path.extname(f).toLowerCase()))
            .sort((a, b) => {
                try {
                    return fs.statSync(path.join(folderPath, a)).mtimeMs - fs.statSync(path.join(folderPath, b)).mtimeMs;
                } catch (e) { return 0; }
            })
            .map(f => ({
                name: f,
                type: imageExts.includes(path.extname(f).toLowerCase()) ? 'image' : 'video',
                url: '/media/' + encodeURIComponent(folder) + '/' + encodeURIComponent(f)
            }));
        res.json(media);
    });
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

    project = path.join(upload_path, project);
    if (!fs.existsSync(project)) fs.mkdirSync(project);

    var filename = nick + '_' + new Date().getTime() + '_' + req.file.originalname.slice(-10);

    fs.renameSync(req.file.path, path.join(project, filename))

    // Notify diaporama clients watching this folder
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
    const videoExts = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv'];
    const ext = path.extname(filename).toLowerCase();
    if ([...imageExts, ...videoExts].includes(ext)) {
        const projectName = req.body.project.replace(/ /g, '_').replace(/[^a-zA-Z0-9_]/g, '').substr(0, 20);
        const mediaInfo = {
            name: filename,
            type: imageExts.includes(ext) ? 'image' : 'video',
            url: '/media/' + encodeURIComponent(projectName) + '/' + encodeURIComponent(filename)
        };
        io.to('diaporama:' + projectName).emit('new-media', mediaInfo);
        console.log('New media pushed to diaporama:', projectName, filename);
    }

    res.send('OK');
})


// Start the server
server.listen(front_port, () => {
    console.log(`Dropfile is running on port ${front_port}`);
    console.log(`File Browser is running on port ${browser_port}`)
});