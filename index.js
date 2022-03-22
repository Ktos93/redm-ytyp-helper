console.log('Main process working');

const electron = require('electron')
const app = electron.app
const BrowserWindow = electron.BrowserWindow
const ipcMain = electron.ipcMain
const dialog = electron.dialog
const path = require('path')
const url = require('url')
const fs = require('fs')
const colors = require('colors')
const Quaternion = require('quaternion')
const convert = require('xml-js')

require('electron-reload')(__dirname, {
    // Note that the path to electron may vary according to the main file
    // electron: require(`${__dirname}/node_modules/electron`)
});

let window;
let filePromise;
let xmlData;
let parentCoord = {x: -379.397308, y: 813.773438, z: 116.921135}
let parentRotation = {w: 0.000000, x: -0.000000, y: 0.000000, z: 1.000000}


createWindow = () => {
	window = new BrowserWindow({width: 900, height: 800, resizable: false,
		autoHideMenuBar: true,
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			enableRemoteModule: false,
			preload: path.join(__dirname, "script.js")
		  }
		})

	window.setMenu(null)
	let htmlURL = path.join(__dirname, 'index.html')
	window.loadURL(htmlURL)

	window.webContents.openDevTools({mode: 'undocked'})
	
	window.on('closed', () => {
		window = null
	})
}

app.on('ready', createWindow)

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit()
	}
})

app.on('activate', () => {
	if (window === null) {
		createWindow()
	}
})

app.on("uncaughtException", (err) => {
	const messageBoxOptions = {
		 type: "error",
		 title: "Error in Main process",
		 message: "Something failed"
	 };
	 dialog.showMessageBoxSync(messageBoxOptions);
});

ipcMain.on('onDragStart',(event, filePath) => {
	console.log('onDragStart event recieved on client core: ' + filePath)
	ymapPath = path.normalize(filePath)
	if(path.extname(ymapPath) == '.ymap'){
		fs.existsSync(ymapPath) ? console.log('YMAP file found: '.green + ymapPath) : (console.log('YMAP file not found: '.red + ymapPath), process.exit())
		filePromise = new Promise((resolve, reject) => {
			fs.readFile(ymapPath, (err, data) => {
				if (err) {
					reject(err)
				}
				xmlData = data
				console.log('File reading complete. Promise resolved!'.green)
				startFileProcessing()
				resolve(event)
			})
		})	
	}
	else{
		console.log('File extension not supported: '.red + path.extname(ymapPath));
		const messageBoxOptions = {
			type: "error",
			title: "Error importing YMAP file",
			message: "File passed was not a YMAP file. Close this window to re-select the file."
		};
		
		let isDialogClosed = dialog.showMessageBoxSync(messageBoxOptions);   
		if (isDialogClosed === 1) {
			event.preventDefault();
		}
		else if(isDialogClosed == 0){
			event.sender.send('fileProcessingStatus', [false])
		}

	}
})

ipcMain.on('setMLOInfo',(event, mloCoordData, mloRotData) => {
	if (mloCoordData.length < 3 || mloRotData.length < 4) {
		console.log('MLO data not valid. Exiting...'.red)
	}
	else{
		console.log('MLO data valid. Proceeding...'.green);
		console.log('MLO Coordinates: '.green, mloCoordData);
		console.log('MLO Rotation: '.green, mloRotData);
		
		parentCoord = {x: mloCoordData[0], y: mloCoordData[1], z: mloCoordData[2]}
		parentRotation = {w: mloRotData[0], x: mloRotData[1], y: mloRotData[2], z: mloRotData[3]}

		console.log('Perma MLO Coordinates: '.green, parentCoord);
		console.log('Perma MLO Rotation: '.green, parentRotation);
	}
})

calculateOffset = (entityCoord, entityRotation, parentCoord, parentRotation) => {

        let offsetCoord = {}
	offsetCoord.x = parentCoord.x - entityCoord.x
	offsetCoord.y = parentCoord.y - entityCoord.y
	offsetCoord.z = parentCoord.z - entityCoord.z

        let entityQuat = new Quaternion(entityRotation.w, entityRotation.x, entityRotation.y, entityRotation.z)
	let parentQuat = new Quaternion(parentRotation.w, parentRotation.x, parentRotation.y, parentRotation.z)
        let parentQuat2 = new Quaternion(parentRotation.w, parentRotation.x, parentRotation.y, parentRotation.z)

        parentQuat.mul(offsetCoord)
        parentQuat.inverse()
        parentQuat.normalize()

        parentQuat2.inverse()
        parentQuat2.normalize()


	// let entityInverse = entityQuat.inverse()
	// let parentInverse = parentQuat.inverse()
	// let offsetRotation = entityQuat.mul(parentInverse)
	// let offsetRotation = parentQuat.mul(entityInverse)
	let offsetRotation = parentQuat.div(entityQuat)

	return [offsetCoord, offsetRotation]
}

guessObjectFlag = (name) => {
	console.log('Got name:', name);
	if(name.includes('door')){
		return 1572864
	}
	else if(name.includes('lamp') || name.includes('light')){
		return 353894400
	}
	else{
		return 1572897
	}
}

startFileProcessing = () => {
	filePromise.then((event) => {
		console.log('File promise resolved!'.green);
		let result = convert.xml2js(xmlData, {compact: true, spaces: 4})

		console.log('Total objects to be converted:'.bold.green, Object.keys(result['CMapData']['entities']['Item']).length)
		console.log()
	
		let index = 1
		let propsData = []

		result['CMapData']['entities']['Item'].forEach(element => {
			let objectName = element['archetypeName']['_text']
			let objectCoord = element['position']['_attributes']
			let objectRotation = element['rotation']['_attributes']

			let objectFlag = guessObjectFlag(objectName)

			console.log('Object name: '.blue+objectName, 'Object index: '.blue+index)
			index += 1
	
			let returnValues = calculateOffset(objectCoord, objectRotation, parentCoord, parentRotation)
			let returnPos = returnValues[0]
			let returnRot = returnValues[1]
			
			propsData[index-1] = {
				name: objectName,
				flags: parseInt(objectFlag),
				rotation: {w:parseFloat((returnRot.w).toFixed(6)), x:parseFloat((returnRot.x).toFixed(6)), y:parseFloat((returnRot.y).toFixed(6)), z:parseFloat((returnRot.z).toFixed(6))},
				position: {x:parseFloat((returnPos.x).toFixed(6)), y:parseFloat((returnPos.y).toFixed(6)), z:parseFloat((returnPos.z).toFixed(6))},
			}
		})
	
		event.sender.send('fileProcessingStatus', [true, propsData])

	})
}
