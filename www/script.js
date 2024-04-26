// Reset 
//Cookies.remove('nick');

// Connect to the server
const socket = io();

// Selected project
var project = null;
if (window.location.hash) project = window.location.hash.substr(1);

// Home
$('#homeTitle').click(() => {
    window.location.hash = '';
    location.reload();
})

// Nick
var nick = Cookies.get('nick');

function getNick(forced) {
    
    while(!nick || forced) {
        nick = prompt('Pseudo', nick);
        nick = nick.replace(/ /g, '_').replace(/[^a-zA-Z0-9_]/g, '').substr(0, 20);
        if (nick.length < 3) {
            forced = true;
            alert('Pseudo trop court');
            continue
        }
        break
    }

    Cookies.set('nick', nick);
    $('#nickDisp').html(nick);

    if (!project) $('#projects').show();
    else selectProject(project);
}

getNick();

$('#nickEditBtn').click(() => {
    getNick(true);
})




// Listen for 'connect' event
socket.on('connect', () => {
    console.log('Connected to server');
});

// Projects list
let projects = [];
socket.on('projects', (data) => {
    projects = data;

    $('#projectsList').empty();
    projects.forEach(project => {
        $('#projectsList').append(`<li data-project="${project}">${project.replace('_', ' ')}</li>`);
    });

    $('#projectsList li').click(function() {
        var project = $(this).data('project');
        selectProject(project);
    });

    if (projects.length == 1) selectProject(projects[0]);
})

// Select project
function selectProject(project) {
    window.location.hash = project;
    $('#projects').hide();
    $('#project').show();
    $('#projectTitle').text( decodeURIComponent(project.replace('_', ' ')) );
    $('#projectUpload').empty();
    $('#projectUpload').append(`<div id="uploadDropzone" class="dropzone"></div>`);

    $("#uploadDropzone").dropzone({ 
        url: "/upload",
        maxFilesize: 300, // MB
        sending: function(file, xhr, formData){
            formData.append('project', project);
            formData.append('nick', nick);
        },
        
    });

    $('#uploadDropzone').html("Cliquez pour uploader !<br />");


}
