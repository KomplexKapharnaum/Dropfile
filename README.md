## DROPFILE

### Install
```
# install Dropfile
git clone https://github.com/KomplexKapharnaum/Dropfile.git
cd Dropfile
npm install

# install Filebrowser
curl -fsSL https://raw.githubusercontent.com/filebrowser/get/master/get.sh | bash

# install pm2 
sudo npm install pm2 -g
```

### Run
```
pm2 start server.js --name Dropfile
```