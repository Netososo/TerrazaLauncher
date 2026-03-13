const remoteMain = require('@electron/remote/main')
remoteMain.initialize()

// Requirements
const { app, BrowserWindow, ipcMain, Menu, nativeImage, safeStorage, shell } = require('electron')
const autoUpdater                       = require('electron-updater').autoUpdater
const ejse                              = require('ejs-electron')
const fs                                = require('fs')
const isDev                             = require('./app/assets/js/isdev')
const path                              = require('path')
const semver                            = require('semver')
const { URL, pathToFileURL }            = require('url')
const { AZURE_CLIENT_ID, MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR, SECURE_STORAGE_OPCODE, SHELL_OPCODE } = require('./app/assets/js/ipcconstants')
const LangLoader                        = require('./app/assets/js/langloader')

// Setup Lang
LangLoader.setupLanguage()

// Setup auto updater.
function initAutoUpdater(event, data) {

    if(data){
        autoUpdater.allowPrerelease = true
    } else {
        // Defaults to true if application version contains prerelease components (e.g. 0.12.1-alpha.1)
        // autoUpdater.allowPrerelease = true
    }
    
    if(isDev){
        autoUpdater.autoInstallOnAppQuit = false
        autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml')
    }
    if(process.platform === 'darwin'){
        autoUpdater.autoDownload = false
    }
    autoUpdater.on('update-available', (info) => {
        event.sender.send('autoUpdateNotification', 'update-available', info)
    })
    autoUpdater.on('update-downloaded', (info) => {
        event.sender.send('autoUpdateNotification', 'update-downloaded', info)
    })
    autoUpdater.on('update-not-available', (info) => {
        event.sender.send('autoUpdateNotification', 'update-not-available', info)
    })
    autoUpdater.on('checking-for-update', () => {
        event.sender.send('autoUpdateNotification', 'checking-for-update')
    })
    autoUpdater.on('error', (err) => {
        event.sender.send('autoUpdateNotification', 'realerror', err)
    }) 
}

// Open channel to listen for update actions.
ipcMain.on('autoUpdateAction', (event, arg, data) => {
    switch(arg){
        case 'initAutoUpdater':
            console.log('Initializing auto updater.')
            initAutoUpdater(event, data)
            event.sender.send('autoUpdateNotification', 'ready')
            break
        case 'checkForUpdate':
            autoUpdater.checkForUpdates()
                .catch(err => {
                    event.sender.send('autoUpdateNotification', 'realerror', err)
                })
            break
        case 'allowPrereleaseChange':
            if(!data){
                const preRelComp = semver.prerelease(app.getVersion())
                if(preRelComp != null && preRelComp.length > 0){
                    autoUpdater.allowPrerelease = true
                } else {
                    autoUpdater.allowPrerelease = data
                }
            } else {
                autoUpdater.allowPrerelease = data
            }
            break
        case 'installUpdateNow':
            autoUpdater.quitAndInstall()
            break
        default:
            console.log('Unknown argument', arg)
            break
    }
})
// Redirect distribution index event from preloader to renderer.
ipcMain.on('distributionIndexDone', (event, res) => {
    event.sender.send('distributionIndexDone', res)
})

// Handle trash item.
ipcMain.handle(SHELL_OPCODE.TRASH_ITEM, async (event, ...args) => {
    try {
        await shell.trashItem(args[0])
        return {
            result: true
        }
    } catch(error) {
        return {
            result: false,
            error: error
        }
    }
})

const SECURE_STORAGE_PREFIX = 'enc:'

function protectConfigSecret(value) {
    if(typeof value !== 'string' || value.length === 0) {
        return {
            result: true,
            value
        }
    }

    if(!safeStorage.isEncryptionAvailable()) {
        return {
            result: true,
            value
        }
    }

    try {
        return {
            result: true,
            value: `${SECURE_STORAGE_PREFIX}${safeStorage.encryptString(value).toString('base64')}`
        }
    } catch (error) {
        return {
            result: false,
            error: error.message
        }
    }
}

function restoreConfigSecret(value) {
    if(typeof value !== 'string' || value.length === 0 || !value.startsWith(SECURE_STORAGE_PREFIX)) {
        return {
            result: true,
            value
        }
    }

    if(!safeStorage.isEncryptionAvailable()) {
        return {
            result: false,
            error: 'Safe storage is not available on this system profile.'
        }
    }

    try {
        const encryptedBuffer = Buffer.from(value.substring(SECURE_STORAGE_PREFIX.length), 'base64')
        return {
            result: true,
            value: safeStorage.decryptString(encryptedBuffer)
        }
    } catch (error) {
        return {
            result: false,
            error: error.message
        }
    }
}

function openExternalUrl(url) {
    shell.openExternal(url).catch((error) => {
        console.warn('Failed to open external URL.', url, error)
    })
}

ipcMain.on(SECURE_STORAGE_OPCODE.ENCRYPT_STRING, (event, value) => {
    event.returnValue = protectConfigSecret(value)
})

ipcMain.on(SECURE_STORAGE_OPCODE.DECRYPT_STRING, (event, value) => {
    event.returnValue = restoreConfigSecret(value)
})

// Disable hardware acceleration.
// https://electronjs.org/docs/tutorial/offscreen-rendering
app.disableHardwareAcceleration()


const REDIRECT_URI_PREFIX = 'https://login.microsoftonline.com/common/oauth2/nativeclient?'

// Microsoft Auth Login
let msftAuthWindow
let msftAuthSuccess
let msftAuthViewSuccess
let msftAuthViewOnClose
ipcMain.on(MSFT_OPCODE.OPEN_LOGIN, (ipcEvent, ...arguments_) => {
    if (msftAuthWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN, msftAuthViewOnClose)
        return
    }
    msftAuthSuccess = false
    msftAuthViewSuccess = arguments_[0]
    msftAuthViewOnClose = arguments_[1]
    msftAuthWindow = new BrowserWindow({
        title: LangLoader.queryJS('index.microsoftLoginTitle'),
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: getPlatformIcon('SealCircle'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    })

    msftAuthWindow.on('closed', () => {
        msftAuthWindow = undefined
    })

    msftAuthWindow.on('close', () => {
        if(!msftAuthSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED, msftAuthViewOnClose)
        }
    })

    msftAuthWindow.webContents.on('did-navigate', (_, uri) => {
        if (uri.startsWith(REDIRECT_URI_PREFIX)) {
            let queries = uri.substring(REDIRECT_URI_PREFIX.length).split('#', 1).toString().split('&')
            let queryMap = {}

            queries.forEach(query => {
                const [name, value] = query.split('=')
                queryMap[name] = decodeURI(value)
            })

            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.SUCCESS, queryMap, msftAuthViewSuccess)

            msftAuthSuccess = true
            msftAuthWindow.close()
            msftAuthWindow = null
        }
    })

    msftAuthWindow.removeMenu()
    msftAuthWindow.loadURL(`https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?prompt=select_account&client_id=${AZURE_CLIENT_ID}&response_type=code&scope=XboxLive.signin%20offline_access&redirect_uri=https://login.microsoftonline.com/common/oauth2/nativeclient`)
})

// Microsoft Auth Logout
let msftLogoutWindow
let msftLogoutSuccess
let msftLogoutSuccessSent
ipcMain.on(MSFT_OPCODE.OPEN_LOGOUT, (ipcEvent, uuid, isLastAccount) => {
    if (msftLogoutWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN)
        return
    }

    msftLogoutSuccess = false
    msftLogoutSuccessSent = false
    msftLogoutWindow = new BrowserWindow({
        title: LangLoader.queryJS('index.microsoftLogoutTitle'),
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: getPlatformIcon('SealCircle'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    })

    msftLogoutWindow.on('closed', () => {
        msftLogoutWindow = undefined
    })

    msftLogoutWindow.on('close', () => {
        if(!msftLogoutSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED)
        } else if(!msftLogoutSuccessSent) {
            msftLogoutSuccessSent = true
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
        }
    })
    
    msftLogoutWindow.webContents.on('did-navigate', (_, uri) => {
        if(uri.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/logoutsession')) {
            msftLogoutSuccess = true
            setTimeout(() => {
                if(!msftLogoutSuccessSent) {
                    msftLogoutSuccessSent = true
                    ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
                }

                if(msftLogoutWindow) {
                    msftLogoutWindow.close()
                    msftLogoutWindow = null
                }
            }, 5000)
        }
    })
    
    msftLogoutWindow.removeMenu()
    msftLogoutWindow.loadURL('https://login.microsoftonline.com/common/oauth2/v2.0/logout')
})

// Keep a global reference of the window object
let win
let iconRefreshListener = null
let currentWindowIconSignature = null
const http = require('http')
const https = require('https')
const os = require('os')
const crypto = require('crypto')
const ICON_DOWNLOAD_TIMEOUT_MS = 3000
const ICON_REFRESH_INTERVAL_MS = 60000
const MAX_ICON_REDIRECTS = 3
const ICON_URL = 'https://terrazastudios.com/terrazalauncher/barra/icon.png'

function withIconRefreshToken(url, token = Math.floor(Date.now() / ICON_REFRESH_INTERVAL_MS).toString()) {
    const parsed = new URL(url)
    parsed.searchParams.set('launcherRefresh', token)
    return parsed.toString()
}

function downloadIconFromURL(url, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        const requestUrl = withIconRefreshToken(url)
        const transport = requestUrl.startsWith('https:') ? https : http
        let settled = false

        const finishWithError = (err) => {
            if(settled) {
                return
            }
            settled = true
            reject(err)
        }

        const request = transport.get(requestUrl, (response) => {
            const statusCode = response.statusCode || 0

            if([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
                response.resume()
                if(redirectCount >= MAX_ICON_REDIRECTS) {
                    finishWithError(new Error('Too many redirects while downloading the launcher icon.'))
                    return
                }

                const redirectedUrl = new URL(response.headers.location, requestUrl).toString()
                downloadIconFromURL(redirectedUrl, redirectCount + 1).then(resolve).catch(finishWithError)
                return
            }

            if(statusCode !== 200) {
                response.resume()
                finishWithError(new Error(`Unexpected status code: ${statusCode}`))
                return
            }

            const chunks = []
            response.on('data', (chunk) => {
                chunks.push(chunk)
            })
            response.on('end', () => {
                if(settled) {
                    return
                }

                try {
                    const buffer = Buffer.concat(chunks)
                    const signature = crypto.createHash('sha1').update(buffer).digest('hex')
                    const dest = path.join(os.tmpdir(), `launcher_dynamic_icon_${signature}.png`)
                    fs.writeFile(dest, buffer, (err) => {
                        if(err) {
                            finishWithError(err)
                            return
                        }

                        settled = true
                        resolve({ path: dest, signature })
                    })
                } catch (err) {
                    finishWithError(err)
                }
            })
            response.on('error', finishWithError)
        })

        request.setTimeout(ICON_DOWNLOAD_TIMEOUT_MS, () => {
            request.destroy(new Error(`Icon download timed out after ${ICON_DOWNLOAD_TIMEOUT_MS}ms`))
        })
        request.on('error', finishWithError)
    })
}

async function refreshWindowIcon(force = false) {
    if(win == null || win.isDestroyed()) {
        return
    }

    try {
        const remoteIcon = await downloadIconFromURL(ICON_URL)
        if(force || remoteIcon.signature !== currentWindowIconSignature) {
            currentWindowIconSignature = remoteIcon.signature
            if(typeof win.setIcon === 'function') {
                win.setIcon(nativeImage.createFromPath(remoteIcon.path))
            }
            console.log('Icono remoto actualizado desde la web.')
        }
    } catch (error) {
        console.log(`No se pudo actualizar el icono remoto: ${error.message}`)
    }
}

function startWindowIconRefresh() {
    if(iconRefreshListener != null) {
        clearInterval(iconRefreshListener)
    }

    iconRefreshListener = setInterval(() => {
        refreshWindowIcon()
    }, ICON_REFRESH_INTERVAL_MS)
}

function stopWindowIconRefresh() {
    if(iconRefreshListener != null) {
        clearInterval(iconRefreshListener)
        iconRefreshListener = null
    }
}

async function createWindow() {

    // Try the remote icon first and fall back to the bundled asset.
    let finalIconPath = getPlatformIcon('SealCircle')
    try {
        const remoteIcon = await downloadIconFromURL(ICON_URL)
        finalIconPath = remoteIcon.path
        currentWindowIconSignature = remoteIcon.signature
        console.log('Icono descargado desde URL:', finalIconPath)
    } catch (e) {
        console.log(`Error descargando icono desde URL, usando icono local. ${e.message}`)
    }

    win = new BrowserWindow({
        width: 980,
        height: 552,
        icon: finalIconPath,
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'app', 'assets', 'js', 'preloader.js'),
            nodeIntegration: true,
            contextIsolation: false
        },
        backgroundColor: '#171614'
    })

    remoteMain.enable(win.webContents)

    const appUrl = pathToFileURL(path.join(__dirname, 'app', 'app.ejs')).toString()

    win.webContents.setWindowOpenHandler(({ url }) => {
        openExternalUrl(url)
        return { action: 'deny' }
    })

    win.webContents.on('will-navigate', (event, url) => {
        if(url !== appUrl) {
            event.preventDefault()
            openExternalUrl(url)
        }
    })

    const data = {
        bkid: Math.floor(
            (Math.random() * fs.readdirSync(
                path.join(__dirname, 'app', 'assets', 'images', 'backgrounds')
            ).length)
        ),
        lang: (str, placeHolders) => LangLoader.queryEJS(str, placeHolders)
    }

    Object.entries(data).forEach(([key, val]) => ejse.data(key, val))

    win.loadURL(appUrl)

    win.removeMenu()
    win.resizable = true

    startWindowIconRefresh()

    win.on('focus', () => {
        refreshWindowIcon()
    })

    win.on('closed', () => {
        stopWindowIconRefresh()
        currentWindowIconSignature = null
        win = null
    })
}


function createMenu() {
    
    if(process.platform === 'darwin') {

        // Extend default included application menu to continue support for quit keyboard shortcut
        let applicationSubMenu = {
            label: 'Application',
            submenu: [{
                label: 'About Application',
                selector: 'orderFrontStandardAboutPanel:'
            }, {
                type: 'separator'
            }, {
                label: 'Quit',
                accelerator: 'Command+Q',
                click: () => {
                    app.quit()
                }
            }]
        }

        // New edit menu adds support for text-editing keyboard shortcuts
        let editSubMenu = {
            label: 'Edit',
            submenu: [{
                label: 'Undo',
                accelerator: 'CmdOrCtrl+Z',
                selector: 'undo:'
            }, {
                label: 'Redo',
                accelerator: 'Shift+CmdOrCtrl+Z',
                selector: 'redo:'
            }, {
                type: 'separator'
            }, {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                selector: 'cut:'
            }, {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                selector: 'copy:'
            }, {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                selector: 'paste:'
            }, {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                selector: 'selectAll:'
            }]
        }

        // Bundle submenus into a single template and build a menu object with it
        let menuTemplate = [applicationSubMenu, editSubMenu]
        let menuObject = Menu.buildFromTemplate(menuTemplate)

        // Assign it to the application
        Menu.setApplicationMenu(menuObject)

    }

}

function getPlatformIcon(filename){
    let ext
    switch(process.platform) {
        case 'win32':
            ext = 'ico'
            break
        case 'darwin':
        case 'linux':
        default:
            ext = 'png'
            break
    }

    return path.join(__dirname, 'app', 'assets', 'images', `${filename}.${ext}`)
}

app.on('ready', createWindow)
app.on('ready', createMenu)

app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
        createWindow()
    }
})