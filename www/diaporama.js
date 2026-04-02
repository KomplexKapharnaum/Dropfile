(function () {
    const params = new URLSearchParams(window.location.search);
    const folderParam = params.get('folder');
    const durationParam = parseInt(params.get('duration'), 10);

    const landing = document.getElementById('landing');
    const player = document.getElementById('player');
    const folderList = document.getElementById('folderList');
    const durationInput = document.getElementById('duration');
    const imgDisplay = document.getElementById('imgDisplay');
    const vidDisplay = document.getElementById('vidDisplay');
    const counter = document.getElementById('counter');
    const freshIndicator = document.getElementById('freshIndicator');

    if (durationParam > 0) durationInput.value = durationParam;

    // If folder is set in URL, start diaporama directly
    if (folderParam) {
        startDiaporama(folderParam, durationParam || parseInt(durationInput.value, 10));
    } else {
        loadFolders();
    }

    // Load folder list
    function loadFolders() {
        fetch('/api/folders')
            .then(r => r.json())
            .then(folders => {
                folderList.innerHTML = '';
                folders.forEach(f => {
                    const li = document.createElement('li');
                    li.textContent = f.replace(/_/g, ' ');
                    li.addEventListener('click', () => {
                        const dur = parseInt(durationInput.value, 10) || 5;
                        window.location.href = '/diaporama?folder=' + encodeURIComponent(f) + '&duration=' + dur;
                    });
                    folderList.appendChild(li);
                });
            });
    }

    // Start the diaporama
    function startDiaporama(folder, duration) {
        landing.classList.add('hidden');
        player.classList.remove('hidden');

        fetch('/api/media/' + encodeURIComponent(folder))
            .then(r => r.json())
            .then(media => {
                if (!media.length) {
                    counter.textContent = 'Aucun média trouvé';
                    return;
                }
                runSlideshow(folder, media, duration);
            });
    }

    function runSlideshow(folder, initialMedia, duration) {
        // --- State ---
        let playlist = initialMedia.slice();   // standard playlist (copy)
        let playlistIndex = 0;                 // current position in standard playlist
        let freshQueue = [];                   // FIFO queue for newly uploaded media
        let playingFresh = false;              // currently showing a fresh media item
        let timer = null;

        // --- Socket.IO: listen for new media ---
        const socket = io();
        socket.emit('diaporama-join', folder);

        socket.on('new-media', (media) => {
            console.log('Fresh media received:', media);
            freshQueue.push(media);
            // If we have nothing playing yet (edge case), kick it off
        });

        // --- Display logic ---
        function updateCounter() {
            if (playingFresh) {
                counter.textContent = '★ ' + freshQueue.length + ' en attente';
                freshIndicator.classList.remove('hidden');
            } else {
                counter.textContent = (playlistIndex + 1) + ' / ' + playlist.length;
                freshIndicator.classList.add('hidden');
            }
        }

        function show(item) {
            updateCounter();

            if (item.type === 'image') {
                vidDisplay.classList.add('hidden');
                vidDisplay.pause();
                vidDisplay.removeAttribute('src');

                imgDisplay.src = item.url;
                imgDisplay.classList.remove('hidden');

                timer = setTimeout(next, duration * 1000);
            } else {
                imgDisplay.classList.add('hidden');

                vidDisplay.src = item.url;
                vidDisplay.classList.remove('hidden');
                vidDisplay.play();

                vidDisplay.onended = next;
                timer = null;
            }
        }

        function next() {
            clearTimeout(timer);
            vidDisplay.onended = null;

            // 1) Fresh queue has priority
            if (freshQueue.length > 0) {
                playingFresh = true;
                const item = freshQueue.shift();
                show(item);
                return;
            }

            // 2) If we were playing fresh, resume standard playlist
            if (playingFresh) {
                playingFresh = false;
            }

            // 3) Advance in standard playlist
            playlistIndex++;

            // 4) If playlist is exhausted, reload it
            if (playlistIndex >= playlist.length) {
                reloadPlaylist();
                return;
            }

            show(playlist[playlistIndex]);
        }

        function reloadPlaylist() {
            fetch('/api/media/' + encodeURIComponent(folder))
                .then(r => r.json())
                .then(media => {
                    if (!media.length) {
                        counter.textContent = 'Aucun média trouvé';
                        return;
                    }
                    playlist = media;
                    playlistIndex = 0;
                    show(playlist[0]);
                });
        }

        // --- Keyboard nav ---
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' || e.key === ' ') {
                clearTimeout(timer);
                vidDisplay.onended = null;
                next();
            } else if (e.key === 'ArrowLeft') {
                clearTimeout(timer);
                vidDisplay.onended = null;
                // Go back in standard playlist only
                if (!playingFresh && playlistIndex > 0) {
                    playlistIndex--;
                    show(playlist[playlistIndex]);
                }
            } else if (e.key === 'Escape') {
                clearTimeout(timer);
                vidDisplay.pause();
                socket.disconnect();
                window.location.href = '/diaporama';
            }
        });

        // --- Start ---
        show(playlist[0]);
    }
})();
