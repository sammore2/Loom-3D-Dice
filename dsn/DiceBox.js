import {DiceColors, COLORSETS} from './DiceColors.js';
import { DICE_MODELS } from './DiceModels.js';
import { RGBELoader } from './libs/three-modules/RGBELoader.js';
//import {GLTFExporter} from './libs/three-modules/GLTFExporter.js';
import * as THREE from './libs/three.module.js';

const DSN_AUDIO_BASE = '/marketplace/addons/dice-so-nice';
function dsnPreloadSound(src) { try { const a = new Audio(src); a.preload = 'auto'; a.load(); return a; } catch { return null; } }
function dsnPlaySound(src, volume=1) { try { const a = new Audio(src); a.volume = volume; a.play().catch(()=>{}); } catch {} }

export class DiceBox {

	constructor(element_container, dice_factory, config) {
		//private variables
		this.known_types = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];
		this._boxTag = Math.random().toString(36).slice(2, 8);
		this.container = element_container;
		this.dimensions = config.dimensions;
		this.dicefactory = dice_factory;
		this.config = config;
		this.speed = 1;
		this.isVisible = false;
		this.adaptive_timestep = false;
		this.last_time = 0;
		this.settle_time = 0;
		this.running = false;
		this.rolling = false;
		this.threadid;

		this.nbIterationsBetweenRolls = 15;

		this.display = {
			currentWidth: null,
			currentHeight: null,
			containerWidth: null,
			containerHeight: null,
			aspect: null,
			scale: null
		};

		this.mouse = {
			pos: new THREE.Vector2(),
			startDrag: undefined,
			startDragTime: undefined
		};

		this.cameraHeight = {
			max: null,
			close: null,
			medium: null,
			far: null
		};

		
		this.clock = new THREE.Clock();
		this.world_sim = new CANNON.World();
		this.dice_body_material = new CANNON.Material();
		this.desk_body_material = new CANNON.Material();
		this.barrier_body_material = new CANNON.Material();
		this.sounds_table = {};
		this.sounds_dice = {};
		this.sounds_coins = [];
		this.lastSoundType = '';
		this.lastSoundStep = 0;
		this.lastSound = 0;
		this.iteration;
		this.renderer;
		this.barrier;
		this.camera;
		this.light;
		this.light_amb;
		this.desk;
		this.pane;

		//public variables
		this.public_interface = {};
		this.diceList = []; //'private' variable
		this.deadDiceList = [];
		this.framerate = (1/60);
		this.sounds = true;
		this.volume = 1;
		this.soundDelay = 1; // time between sound effects in worldstep
		this.soundsSurface = "felt";
		this.animstate = '';
		this.throwingForce = "medium";

		this.selector = {
			animate: true,
			rotate: true,
			intersected: null,
			dice: []
		};

		this.colors = {
			ambient:  0xffffff,
			spotlight: 0xffffff,
			ground:0x242644
		};

		this.shadows = true;

		this.rethrowFunctions = {};
		this.afterThrowFunctions = {};

		this._rafRunning = false;
		this._animFn = null;

		//clean cache
		this.dicefactory.disposeCachedMaterials(config.boxType);
	}

	// Driver externo: a caixa NÃO agenda nada sozinha. rAF, setTimeout e
	// setInterval criados aqui eram suprimidos neste contexto sem erro
	// (o 2º roll travava mudo com iteration 0). Quem chama _startLoop deve
	// chamar _pump() em cadência (~30ms, feito pelo Dice3D no client.js);
	// o animateThrow calcula neededSteps pelo relógio, então a cadência
	// exata não importa.
	_startLoop(fn) {
		this._stopLoop();
		this._rafRunning = true;
		this._animFn = fn;
		console.log('[dice-so-nice] animation loop agendado');
	}

	// Um passo de animação, chamado pelo driver externo.
	_pump() {
		this._pumpTicks = (this._pumpTicks || 0) + 1;
		if (!this._rafRunning || !this._animFn) {
			// Só loga com roll pendente (rolling=true): idle pula silencioso.
			if (this.rolling) console.log('[dice-so-nice] pump SKIP', { running: this._rafRunning, hasFn: !!this._animFn, dice: this.diceList.length, iter: this.iteration });
			return;
		}
		try {
			this._animFn.call(this);
		} catch (err) {
			console.error('[dice-so-nice] animation frame ERRO:', err);
			this._stopLoop();
			this.rolling = false;
			if (this.callback) { const cb = this.callback; this.callback = null; cb(this.throws); }
		}
	}

	_stopLoop() {
		if (this._rafRunning) console.log('[dice-so-nice] animation loop parado');
		this._rafRunning = false;
		this._animFn = null;
	}

	preloadSounds(){

		let surfaces = [
			['felt', 7],
			['wood_table', 7],
			['wood_tray', 7],
			['metal', 9]
		];

		for (const [surface, numsounds] of surfaces) {
			this.sounds_table[surface] = [];
			for (let s=1; s <= numsounds; ++s) {
				let path = `/marketplace/addons/dice-so-nice/sounds/${surface}/surface_${surface}${s}.wav`;
				dsnPreloadSound(path);
				this.sounds_table[surface].push(path);
			}
		}

		let materials = [
			['plastic', 15],
			['metal', 12],
			['wood', 12]
		];

		for (const [material, numsounds] of materials) {
			this.sounds_dice[material] = [];
			for (let s=1; s <= numsounds; ++s) {
				let path = `/marketplace/addons/dice-so-nice/sounds/dicehit/dicehit${s}_${material}.wav`;
				dsnPreloadSound(path);
				this.sounds_dice[material].push(path);
			}
		}

		for (let i=1; i <= 6; ++i) {
			let path = `/marketplace/addons/dice-so-nice/sounds/dicehit/coinhit${i}.wav`;
			dsnPreloadSound(path);
			this.sounds_coins.push(path);
		}
	}

	initialize() {
		return new Promise(async resolve => {
			if(this.config.system != "standard")
				this.dicefactory.setSystem(this.config.system);

			this.sounds = this.config.sounds == '1';
			this.volume = this.config.soundsVolume;
			this.soundsSurface = this.config.soundsSurface;
			this.shadows = this.config.shadowQuality != "none";
			this.dicefactory.setBumpMapping(this.config.bumpMapping);
			let globalAnimationSpeed = this.config.globalAnimationSpeed ?? "0";
			if(globalAnimationSpeed === "0" || globalAnimationSpeed === 0)
				this.speed = parseInt(this.config.speed ?? 1, 10);
			else
				this.speed = parseInt(globalAnimationSpeed,10);
			this.throwingForce = this.config.throwingForce;

			this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference:"high-performance"});
			if(this.dicefactory.bumpMapping){
				this.renderer.physicallyCorrectLights = true;
				this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
				this.renderer.toneMappingExposure = 0.9;
				this.renderer.outputEncoding = THREE.sRGBEncoding;
			}

			this.scene = new THREE.Scene();
			await this.loadContextScopedTextures(this.config.boxType);
			this.dicefactory.initializeMaterials();
			/*this.rendererStats	= new THREEx.RendererStats()

			this.rendererStats.domElement.style.position	= 'absolute';
			this.rendererStats.domElement.style.left	= '44px';
			this.rendererStats.domElement.style.bottom	= '178px';
			this.rendererStats.domElement.style.transform	= 'scale(2)';
			document.body.appendChild( this.rendererStats.domElement );*/

			this.container.appendChild(this.renderer.domElement);
			this.renderer.shadowMap.enabled = this.shadows;
			this.renderer.shadowMap.type = this.config.shadowQuality == "high" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
			this.renderer.setClearColor(0x000000, 0);

			this.setDimensions(this.config.dimensions);

			this.world_sim.gravity.set(0, 0, -9.8 * 800);
			this.world_sim.broadphase = new CANNON.NaiveBroadphase();
			this.world_sim.solver.iterations = 14;
			this.world_sim.allowSleep = true;
		
			let contactMaterial = new CANNON.ContactMaterial( this.desk_body_material, this.dice_body_material, {friction: 0.01, restitution: 0.5});
			this.world_sim.addContactMaterial(contactMaterial);
			contactMaterial = new CANNON.ContactMaterial( this.barrier_body_material, this.dice_body_material, {friction: 0, restitution: 0.95});
			this.world_sim.addContactMaterial(contactMaterial);
			contactMaterial = new CANNON.ContactMaterial( this.dice_body_material, this.dice_body_material, {friction: 0.01, restitution: 0.7});
			this.world_sim.addContactMaterial(contactMaterial);
			let desk = new CANNON.Body({allowSleep: false, mass: 0, shape: new CANNON.Plane(), material: this.desk_body_material});
			this.world_sim.addBody(desk);
			
			let barrier = new CANNON.Body({allowSleep: false, mass: 0, shape: new CANNON.Plane(), material: this.barrier_body_material});
			barrier.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2);
			barrier.position.set(0, this.display.containerHeight * 0.93, 0);
			this.world_sim.addBody(barrier);

			barrier = new CANNON.Body({allowSleep: false, mass: 0, shape: new CANNON.Plane(), material: this.barrier_body_material});
			barrier.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
			barrier.position.set(0, -this.display.containerHeight * 0.93, 0);
			this.world_sim.addBody(barrier);

			barrier = new CANNON.Body({allowSleep: false, mass: 0, shape: new CANNON.Plane(), material: this.barrier_body_material});
			barrier.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -Math.PI / 2);
			barrier.position.set(this.display.containerWidth * 0.93, 0, 0);
			this.world_sim.addBody(barrier);

			barrier = new CANNON.Body({allowSleep: false, mass: 0, shape: new CANNON.Plane(), material: this.barrier_body_material});
			barrier.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI / 2);
			barrier.position.set(-this.display.containerWidth * 0.93, 0, 0);
			this.world_sim.addBody(barrier);

			this.renderer.render(this.scene, this.camera);
			resolve();
		});
	}

	loadContextScopedTextures(type){
		return new Promise(resolve => {
			this.scopedTextureCache = {type:type};
			if(this.dicefactory.bumpMapping){
				let textureLoader = new THREE.TextureLoader();
				this.scopedTextureCache.roughnessMap_fingerprint = textureLoader.load('/marketplace/addons/dice-so-nice/textures/roughnessMap_finger.webp');
				this.scopedTextureCache.roughnessMap_wood = textureLoader.load('/marketplace/addons/dice-so-nice/textures/roughnessMap_wood.webp');
				this.scopedTextureCache.roughnessMap_metal = textureLoader.load('/marketplace/addons/dice-so-nice/textures/roughnessMap_metal.webp');

				this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
				this.pmremGenerator.compileEquirectangularShader();

				new RGBELoader()
				.setDataType( THREE.UnsignedByteType )
				.setPath( '/marketplace/addons/dice-so-nice/textures/equirectangular/' )
				.load('foyer.hdr', function ( texture ) {
					this.scopedTextureCache.textureCube = this.pmremGenerator.fromEquirectangular(texture).texture;
					this.scene.environment = this.scopedTextureCache.textureCube;
					this.scene.traverse(object => {
						if(object.type === 'Mesh') object.material.needsUpdate = true;
					});
	
					texture.dispose();
					this.pmremGenerator.dispose();
					resolve();
					
				}.bind(this));
			} else {
				let loader = new THREE.CubeTextureLoader();
				loader.setPath('/marketplace/addons/dice-so-nice/textures/cubemap/');

				this.scopedTextureCache.textureCube = loader.load( [
					'px.webp', 'nx.webp',
					'py.webp', 'ny.webp',
					'pz.webp', 'nz.webp'
				]);
				resolve();
			}
		});
	}

	setDimensions(dimensions) {
		this.display.currentWidth = this.container.clientWidth / 2;
		this.display.currentHeight = this.container.clientHeight / 2;
		if (dimensions) {
			this.display.containerWidth = dimensions.w;
			this.display.containerHeight = dimensions.h;
		} else {
			this.display.containerWidth = this.display.currentWidth;
			this.display.containerHeight = this.display.currentHeight;
		}
		this.display.aspect = Math.min(this.display.currentWidth / this.display.containerWidth, this.display.currentHeight / this.display.containerHeight);

		if(this.config.autoscale)
			this.display.scale = Math.sqrt(this.display.containerWidth * this.display.containerWidth + this.display.containerHeight * this.display.containerHeight) / 13;
		else
			this.display.scale = this.config.scale;
		if(this.config.boxType == "board")
			this.dicefactory.setScale(this.display.scale);
		this.renderer.setSize(this.display.currentWidth * 2, this.display.currentHeight * 2);

		this.cameraHeight.max = this.display.currentHeight / this.display.aspect / Math.tan(10 * Math.PI / 180);

		this.cameraHeight.medium = this.cameraHeight.max / 1.5;
		this.cameraHeight.far = this.cameraHeight.max;
		this.cameraHeight.close = this.cameraHeight.max / 2;

		if (this.camera) this.scene.remove(this.camera);
		this.camera = new THREE.PerspectiveCamera(20, this.display.currentWidth / this.display.currentHeight, 1, this.cameraHeight.max * 1.3);

		switch (this.animstate) {
			case 'selector':
				this.camera.position.z = this.selector.dice.length > 9 ? this.cameraHeight.far : (this.selector.dice.length < 6 ? this.cameraHeight.close : this.cameraHeight.medium);
				break;
			case 'throw': case 'afterthrow': default: this.camera.position.z = this.cameraHeight.far;

		}

		this.camera.lookAt(new THREE.Vector3(0,0,0));
		
		const maxwidth = Math.max(this.display.containerWidth, this.display.containerHeight);

		if (this.light) this.scene.remove(this.light);
		if (this.light_amb) this.scene.remove(this.light_amb);

		let intensity;
		if(this.dicefactory.bumpMapping){ //advanced lighting
			intensity = 0.6;
		} else {
			intensity = 0.7;
			this.light_amb = new THREE.HemisphereLight(this.colors.ambient, this.colors.ground, 1);
			this.scene.add(this.light_amb);
		}
		
		this.light = new THREE.DirectionalLight(this.colors.spotlight, intensity);
		this.light.position.set(-this.display.containerWidth/10, this.display.containerHeight/10, maxwidth/2);
		this.light.target.position.set(0, 0, 0);
		this.light.distance = 0;
		this.light.castShadow = this.shadows;
		this.light.shadow.camera.near = maxwidth / 10;
		this.light.shadow.camera.far = maxwidth * 5;
		this.light.shadow.camera.fov = 50;
		this.light.shadow.bias = -0.0001;;
		this.light.shadow.mapSize.width = 1024;
		this.light.shadow.mapSize.height = 1024;
		const d = 1000;
		this.light.shadow.camera.left = - d;
		this.light.shadow.camera.right = d;
		this.light.shadow.camera.top = d;
		this.light.shadow.camera.bottom = - d;
		this.scene.add(this.light);

	
		if (this.desk)
			this.scene.remove(this.desk);

		let shadowplane = new THREE.ShadowMaterial();
		shadowplane.opacity = 0.5;
		this.desk = new THREE.Mesh(new THREE.PlaneGeometry(this.display.containerWidth * 6, this.display.containerHeight * 6, 1, 1), shadowplane);
		this.desk.receiveShadow = this.shadows;
		this.scene.add(this.desk);

		this.renderer.render(this.scene, this.camera);
	}

	update(config) {
        if(config.autoscale) {
            this.display.scale = Math.sqrt(this.display.containerWidth * this.display.containerWidth + this.display.containerHeight * this.display.containerHeight) / 13;
        } else {
            this.display.scale = config.scale
        }
		this.dicefactory.setScale(this.display.scale);
		this.dicefactory.setBumpMapping(config.bumpMapping);

		let globalAnimationSpeed = config.globalAnimationSpeed ?? this.config.globalAnimationSpeed ?? "0";
		if(globalAnimationSpeed === "0" || globalAnimationSpeed === 0)
			this.speed = parseInt(config.speed ?? this.config.speed ?? 1,10);
		else
			this.speed = parseInt(globalAnimationSpeed,10);
		this.shadows = config.shadowQuality != "none";
		if (this.light) this.light.castShadow = this.shadows;
		if (this.desk) this.desk.receiveShadow = this.shadows;
		if (this.renderer && this.renderer.shadowMap) {
			this.renderer.shadowMap.enabled = this.shadows;
			this.renderer.shadowMap.type = config.shadowQuality == "high" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
		}
		this.sounds = config.sounds;
		this.volume = config.soundsVolume;
		this.soundsSurface = config.soundsSurface;
		if(config.system)
			this.dicefactory.setSystem(config.system);
		this.applyColorsForRoll(config);
		this.throwingForce = config.throwingForce;
		if (this.scene) {
			this.scene.traverse(object => {
				if(object.type === 'Mesh' && object.material) {
					if (Array.isArray(object.material)) {
						object.material.forEach(m => { if (m) m.needsUpdate = true; });
					} else {
						object.material.needsUpdate = true;
					}
				}
			});
		}
    }


	vectorRand({x, y}) {
		let angle = Math.random() * Math.PI / 5 - Math.PI / 5 / 2;
		let vec = {
			x: x * Math.cos(angle) - y * Math.sin(angle),
			y: x * Math.sin(angle) + y * Math.cos(angle)
		};
		if (vec.x == 0) vec.x = 0.01;
		if (vec.y == 0) vec.y = 0.01;
		return vec;
	}

	//returns an array of vectordata objects
	getVectors(notationVectors, vector, boost, dist){

		// Separação mínima de spawn: dados nascendo sobrepostos explodem na
		// física (velocidades NaN/enormes), nunca dormem e o sim sai pelo
		// teto de 1000 iterações sem setar iterationsNeeded (skip mudo).
		const placed = [];
		const minDist = (this.display.scale || 150) * 1.5;
		const basePos = (vec) => ({
			x: this.display.containerWidth * (vec.x > 0 ? -1 : 1) * 0.9 + Math.floor(Math.random() * 201) - 100 ,
			y: this.display.containerHeight * (vec.y > 0 ? -1 : 1) * 0.9 + Math.floor(Math.random() * 201) - 100,
			z: Math.random() * 200 + 200
		});
		const clearance = (p) => {
			let m = Infinity;
			for (const q of placed) {
				const dx = p.x - q.x, dy = p.y - q.y;
				const d = Math.sqrt(dx * dx + dy * dy);
				if (d < m) m = d;
			}
			return m;
		};

		for (let i = 0;i< notationVectors.dice.length;i++) {

			let diceobj = this.dicefactory.get(notationVectors.dice[i].type);
			if (!diceobj) {
				// Preset custom não registrado (ex: sistema ainda carregando):
				// cai para o d10 padrão em vez de estourar e pular o throw.
				console.warn(`[dice-so-nice] preset '${notationVectors.dice[i].type}' ausente, usando d10`);
				notationVectors.dice[i].type = 'd10';
				diceobj = this.dicefactory.get('d10');
				if (!diceobj) continue;
			}

			let vec = this.vectorRand(vector);

			vec.x /= dist;
			vec.y /= dist;

			let pos = basePos(vec);
			if (placed.length > 0) {
				let best = pos, bestClear = clearance(pos);
				for (let t = 0; t < 12 && bestClear < minDist; t++) {
					const cand = basePos(vec);
					const c = clearance(cand);
					if (c > bestClear) { best = cand; bestClear = c; }
				}
				pos = best;
			}
			placed.push(pos);

			let projector = Math.abs(vec.x / vec.y);
			if (projector > 1.0) pos.y /= projector; else pos.x *= projector;


			let velvec = this.vectorRand(vector);

			velvec.x /= dist;
			velvec.y /= dist;
			let velocity, angle, axis;

			if(diceobj.shape != "d2"){

				velocity = { 
					x: velvec.x * boost, 
					y: velvec.y * boost, 
					z: -10
				};

				angle = {
					x: -(Math.random() * vec.y * 5 + diceobj.inertia * vec.y),
					y: Math.random() * vec.x * 5 + diceobj.inertia * vec.x,
					z: 0
				};

				axis = { 
					x: Math.random(), 
					y: Math.random(), 
					z: Math.random(), 
					a: Math.random()
				};

				axis = { 
					x: 0, 
					y: 0, 
					z: 0, 
					a: 0
				};
			}else {
				//coin flip
				velocity = { 
					x: velvec.x * boost / 10, 
					y: velvec.y * boost / 10, 
					z: 3000
				};

				angle = {
					x: 12 * diceobj.inertia,//-(Math.random() * velvec.y * 50 + diceobj.inertia * velvec.y ) ,
					y: 1 * diceobj.inertia,//Math.random() * velvec.x * 50 + diceobj.inertia * velvec.x ,
					z: 0
				};

				axis = { 
					x: 1,//Math.random(), 
					y: 1,//Math.random(), 
					z: Math.random(), 
					a: Math.random()
				};
			}

			notationVectors.dice[i].vectors = { 
				type: diceobj.type,  
				pos, 
				velocity, 
				angle, 
				axis
			};           
		}
		return notationVectors;
	}

	// swaps dice faces to match desired result
	swapDiceFace(dicemesh){
		const diceobj = this.dicefactory.get(dicemesh.notation.type);

		let value = parseInt(dicemesh.getLastValue().value);
		let result = parseInt(dicemesh.forcedResult);
		
		if (diceobj.shape == 'd10' && result == 0) result = 10;

		if(diceobj.valueMap){ //die with special values
			result = diceobj.valueMap[result];
		}
	
		if(value == result) return;

		// Dados sem valor simulado ou sem rotação mapeada mantêm a face
		// natural em vez de quebrar a animação inteira.
		if(!Number.isFinite(value) || !Number.isFinite(result)) return;
		let rotIndex = value > result ? result+","+value:value+","+result;
		let model = DICE_MODELS[dicemesh.shape];
		let rotationDegrees = model && model.rotationCombinations ? model.rotationCombinations[rotIndex] : undefined;
		if(!rotationDegrees) return;
		let eulerAngle = new THREE.Euler(THREE.MathUtils.degToRad(rotationDegrees[0]),THREE.MathUtils.degToRad(rotationDegrees[1]),THREE.MathUtils.degToRad(rotationDegrees[2]));
		let quaternion = new THREE.Quaternion().setFromEuler(eulerAngle);
		if(value > result)
			quaternion.inverse();
		
		dicemesh.applyQuaternion(quaternion);

		dicemesh.resultReason = 'forced';
	}

	//spawns one dicemesh object from a single vectordata object
	spawnDice(dicedata) {
		let vectordata = dicedata.vectors;
		const diceobj = this.dicefactory.get(vectordata.type);
		if(!diceobj) return;
		let colorset = null;
		if(dicedata.options.colorset)
			colorset = dicedata.options.colorset;
		else if(dicedata.options.flavor && COLORSETS[dicedata.options.flavor]){
			colorset = dicedata.options.flavor;
		}

		let dicemesh = this.dicefactory.create(this.scopedTextureCache, diceobj.type, colorset);
		if(!dicemesh) return;

		let mass = diceobj.mass;
		switch(this.dicefactory.material_rand){
			case "metal":
				mass *= 7;
				break;
			case "wood":
				mass *= 0.65;
				break;
			case "glass":
				mass *= 2;
				break;
		}

		dicemesh.notation = vectordata;
		dicemesh.result = [];
		dicemesh.forcedResult = dicedata.result;
		dicemesh.startAtIteration = dicedata.startAtIteration;
		dicemesh.stopped = 0;
		dicemesh.castShadow = this.shadows;

		dicemesh.body_sim = new CANNON.Body({allowSleep: true, sleepSpeedLimit: 75, sleepTimeLimit:0.9,mass: mass, shape: dicemesh.geometry.cannon_shape, material: this.dice_body_material});
		dicemesh.body_sim.type = CANNON.Body.DYNAMIC;
		dicemesh.body_sim.position.set(vectordata.pos.x, vectordata.pos.y, vectordata.pos.z);
		dicemesh.body_sim.quaternion.setFromAxisAngle(new CANNON.Vec3(vectordata.axis.x, vectordata.axis.y, vectordata.axis.z), vectordata.axis.a * Math.PI * 2);
		dicemesh.body_sim.angularVelocity.set(vectordata.angle.x, vectordata.angle.y, vectordata.angle.z);
		dicemesh.body_sim.velocity.set(vectordata.velocity.x, vectordata.velocity.y, vectordata.velocity.z);
		dicemesh.body_sim.linearDamping = 0.1;
		dicemesh.body_sim.angularDamping = 0.1;
		dicemesh.body_sim.addEventListener('collide', this.eventCollide.bind(this));
		dicemesh.body_sim.stepQuaternions = new Array(1000);
		dicemesh.body_sim.stepPositions = new Array(1000);

		/*var gltfExporter = new GLTFExporter();
		gltfExporter.parse(dicemesh, function ( result ) {
			if ( result instanceof ArrayBuffer ) {
				saveArrayBuffer( result, 'scene.glb' );
			} else {
				var output = JSON.stringify( result, null, 2 );
				console.log( output );
				saveString( output, 'scene.gltf' );
			}
		}, {});

		var link = document.createElement( 'a' );
		link.style.display = 'none';
		document.body.appendChild( link ); // Firefox workaround, see #6594

		function save( blob, filename ) {
			link.href = URL.createObjectURL( blob );
			link.download = filename;
			link.click();
			// URL.revokeObjectURL( url ); breaks Firefox...
		}

		function saveString( text, filename ) {
			save( new Blob( [ text ], { type: 'text/plain' } ), filename );
		}

		function saveArrayBuffer( buffer, filename ) {
			save( new Blob( [ buffer ], { type: 'application/octet-stream' } ), filename );
		}*/


		let objectContainer = new THREE.Object3D();
		objectContainer.add(dicemesh);

		this.diceList.push(dicemesh);
		if(dicemesh.startAtIteration == 0){
			this.scene.add(objectContainer);
			this.world_sim.addBody(dicemesh.body_sim);
		}
	}

	eventCollide({body, target}) {
		// collision events happen simultaneously for both colliding bodies
		// all this sanity checking helps limits sounds being played
		if (!this.sounds || !body || !this.sounds_dice.plastic) return;
		
		let now = body.world.stepnumber;
		let currentSoundType = (body.mass > 0) ? 'dice' : 'table';

		// the idea here is that a dice clack should never be skipped in favor of a table sound
		// if ((don't play sounds if we played one this world step, or there hasn't been enough delay) AND 'this sound IS NOT a dice clack') then 'skip it'
		if ((this.lastSoundStep == body.world.stepnumber || this.lastSound > body.world.stepnumber) && currentSoundType != 'dice') return;

		// also skip if it's too early and both last sound and this sound are the same
		if ((this.lastSoundStep == body.world.stepnumber || this.lastSound > body.world.stepnumber) && currentSoundType == 'dice' && this.lastSoundType == 'dice') return;

		if (body.mass > 0) { // dice to dice collision
			let speed = body.velocity.length();
			// also don't bother playing at low speeds
			if (speed < 250) return;

			let strength = Math.max(Math.min(speed / (550), 1), 0.2);
			let sound;

			if(body.diceType != "dc"){
				let sounds_dice = this.sounds_dice['plastic'];
				if(this.sounds_dice[body.diceMaterial])
					sounds_dice = this.sounds_dice[body.diceMaterial];
				sound = sounds_dice[Math.floor(Math.random() * sounds_dice.length)];
			}
			else
				sound = this.sounds_coins[Math.floor(Math.random() * this.sounds_coins.length)];
			this.detectedCollides[this.iteration] = [sound,strength];
			this.lastSoundType = 'dice';


		} else { // dice to table collision
			let speed = target.velocity.length();
			// also don't bother playing at low speeds
			if (speed < 100) return;

			let surface = this.soundsSurface;
			let strength = Math.max(Math.min(speed / (500), 1), 0.2);

			let soundlist = this.sounds_table[surface];
			let sound = soundlist[Math.floor(Math.random() * soundlist.length)];
			this.detectedCollides[this.iteration] = [sound,strength];

			this.lastSoundType = 'table';
		}
		this.lastSoundStep = body.world.stepnumber;
		this.lastSound = body.world.stepnumber + this.soundDelay;
	}

	playSoundCollide(sound){
		let volume = sound[1] * this.volume;
		dsnPlaySound(sound[0], volume);
	}

	throwFinished(worldType = "render")  {
		
		let stopped = true;
		if (this.iteration > 1000) return true;
		if (this.iteration <= this.minIterations) return false;
		if(worldType == "render"){
			stopped = this.iteration>=this.iterationsNeeded;
			if(stopped){
				for (let i=0, len=this.diceList.length; i < len; ++i){
					this.diceList[i].body_sim.stepPositions = new Array(1000);
					this.diceList[i].body_sim.stepQuaternions = new Array(1000);
					this.diceList[i].body_sim.detectedCollides = [];
					if(!this.diceList[i].body_sim.mass)
						this.diceList[i].body_sim.dead= true;
				}
			}
		}
		else{
			for (let i=0, len=this.diceList.length; i < len; ++i) {
				if(this.diceList[i].body_sim.sleepState < 2)
					return false;
				else if(this.diceList[i].result.length==0)
					this.diceList[i].storeRolledValue();
			}
			//Throw is actually finished
			if(stopped){
				this.iterationsNeeded = this.iteration;
				let canBeFlipped = this.config.diceCanBeFlipped ?? true;
				if(!canBeFlipped){
					//make the current dice on the board STATIC object so they can't be knocked
					for (let i=0, len=this.diceList.length; i < len; ++i){
						this.diceList[i].body_sim.mass = 0;
						this.diceList[i].body_sim.updateMassProperties();
					}
				}
			}
		}
		return stopped;
	}

	simulateThrow() {
		this.detectedCollides = new Array(1000);
		this.iterationsNeeded = 0;
		this.animstate = 'simulate';
		this.settle_time = 0;
		this.rolling = true;
		while (!this.throwFinished("sim")) {
			//Before each step, we copy the quaternions of every die in an array
			++this.iteration;
			
			if(!(this.iteration % this.nbIterationsBetweenRolls)){
				for(let i = 0; i < this.diceList.length; i++){
					if(this.diceList[i].startAtIteration == this.iteration)
						this.world_sim.addBody(this.diceList[i].body_sim);
				}
			}
			this.world_sim.step(this.framerate);
			
			for(let i = 0; i < this.world_sim.bodies.length; i++){
				if(this.world_sim.bodies[i].stepPositions){
					this.world_sim.bodies[i].stepQuaternions[this.iteration] = {
						"w":this.world_sim.bodies[i].quaternion.w,
						"x":this.world_sim.bodies[i].quaternion.x,
						"y":this.world_sim.bodies[i].quaternion.y,
						"z":this.world_sim.bodies[i].quaternion.z
					};
					this.world_sim.bodies[i].stepPositions[this.iteration] = {
						"x":this.world_sim.bodies[i].position.x,
						"y":this.world_sim.bodies[i].position.y,
						"z":this.world_sim.bodies[i].position.z
					};
				}
			}
		}
	}

	animateThrow(){
		this.animstate = 'throw';
		let time = (new Date()).getTime();
		// Blindagem numérica: qualquer NaN/estado inválido aqui travava o
		// roll em silêncio (comparações com NaN são falsas, nada lança).
		// Sanitiza em vez de confiar, e garante progresso mínimo.
		if (!Number.isFinite(this.framerate) || this.framerate <= 0) {
			console.log('[dice-so-nice] sanitize: framerate inválido, reset 1/60');
			this.framerate = 1 / 60;
		}
		if (!Number.isFinite(time)) time = performance.now();
		// Ancora o relógio UMA vez (sem subtrair framerate): a forma antiga
		// `last_time || time-framerate` zerava a cada frame em displays de
		// 120Hz+ (frame ~8ms < 16.67ms → neededSteps sempre 0 → stall mudo).
		// Ancorando, a fração acumula e nenhuma fração de tempo se perde.
		if (!Number.isFinite(this.last_time) || !this.last_time) this.last_time = time;
		let time_diff = (time - this.last_time) / 1000;

		let neededSteps = Math.floor(time_diff / this.framerate);
		if (!Number.isFinite(neededSteps) || neededSteps < 0) {
			console.log('[dice-so-nice] sanitize: neededSteps inválido, forçando 1');
			neededSteps = 1;
		}

		//Update animated dice mixer
		if(this.animatedDiceDetected){
			let delta = this.clock.getDelta();
			for(let i in this.scene.children){
				let container = this.scene.children[i];
				let dicemesh = container.children && container.children.length && container.children[0].body_sim != undefined ? container.children[0]:null;
				if(dicemesh && dicemesh.mixer){
					dicemesh.mixer.update(delta);
				}
			}
		}

		if(neededSteps && this.rolling){
			for(let i =0; i < neededSteps*this.speed; i++) {
				++this.iteration;
				if(!(this.iteration % this.nbIterationsBetweenRolls)){
					for(let i = 0; i < this.diceList.length; i++){
						if(this.diceList[i].startAtIteration == this.iteration){
							this.scene.add(this.diceList[i].parent);
						}		
					}
				}
			}
			if(this.iteration > this.iterationsNeeded)
				this.iteration = this.iterationsNeeded;

			// update physics interactions visually
		
			for (let i in this.scene.children) {
				let container = this.scene.children[i];
				let dicemesh = container.children && container.children.length && container.children[0].body_sim != undefined && !container.children[0].body_sim.dead ? container.children[0]:null;
			if (dicemesh) {
				// Defesa extra: container órfão (rolagem anterior já limpa)
				// sem posição registrada neste iteration é ignorado.
				const sp = dicemesh.body_sim.stepPositions[this.iteration];
				const sq = dicemesh.body_sim.stepQuaternions[this.iteration];
				if (!sp || !sq) continue;
				container.position.copy(sp);
				container.quaternion.copy(sq);
					
				if(dicemesh.meshCannon){
					dicemesh.meshCannon.position.copy(sp);
					dicemesh.meshCannon.quaternion.copy(sq);
				}
			}
			}
			if(this.detectedCollides[this.iteration]){
				this.playSoundCollide(this.detectedCollides[this.iteration]);
			}
		} 

		if(this.animatedDiceDetected || neededSteps)
			this.renderer.render(this.scene, this.camera);
		//this.rendererStats.update(this.renderer);
		this.last_time = this.last_time + neededSteps*this.framerate*1000;

		// roll finished
		if (this.throwFinished("render")) {
			//if animated dice still on the table, keep animating
			
			this.running = false;
			this.rolling = false;

			if(this.callback) this.callback(this.throws);
			this.callback = null;
			this.throws = null;
			this.running = (new Date()).getTime();
			if(!this.animatedDiceDetected)
				this._stopLoop();
		}
	}

	start_throw(throws, callback) {
		console.log(`[dice-so-nice] start_throw: box=${this._boxTag} rolling=${this.rolling} dice=${throws.reduce((n,t)=>n+(t.dice?t.dice.length:0),0)}`);
		if (this.rolling) return;
		this.isVisible = true;
		let countNewDice = 0;
		throws.forEach(notation => {
			let vector = { x: (Math.random() * 2 - 0.5) * this.display.currentWidth, y: -(Math.random() * 2 - 0.5) * this.display.currentHeight};
			let dist = Math.sqrt(vector.x * vector.x + vector.y * vector.y);
			let throwingForceModifier = 0.8;
			switch(this.throwingForce){
				case "weak":
					throwingForceModifier = 0.5;
					break;
				case "strong":
					throwingForceModifier = 1.8;
					break;
			}
			let boost = ((Math.random() + 3)*throwingForceModifier) * dist;

			notation = this.getVectors(notation, vector, boost, dist);
			countNewDice += notation.dice.length;
		});

		let maxDiceNumber = this.config.maxDiceNumber ?? 20;
		if(this.deadDiceList.length + this.diceList.length +  countNewDice > maxDiceNumber) {
			this.clearAll();
		}

		this.rollDice(throws,callback);
	}

	applyColorsForRoll(dsnConfig){
		let texture = null;
		let material = null;
		if(dsnConfig.colorset == "custom")
			DiceColors.setColorCustom(dsnConfig.labelColor, dsnConfig.diceColor, dsnConfig.outlineColor, dsnConfig.edgeColor);

		if(dsnConfig.texture != "none")
			texture = dsnConfig.texture;
		else if(dsnConfig.colorset != "custom")
		{
			let set = DiceColors.getColorSet(dsnConfig.colorset);
			texture = set.texture.id;
		}

		if(dsnConfig.material != "auto")
			material = dsnConfig.material;
		else if(dsnConfig.colorset != "custom")
		{
			let set = DiceColors.getColorSet(dsnConfig.colorset);
			material = set.material;
		}

		DiceColors.applyColorSet(this.dicefactory, dsnConfig.colorset, texture, material);
	}

	clearDice() {
		this.running = false;
		// Dados da rolagem anterior saem de cena: marca como mortos para o
		// loop de render (animateThrow) ignorá-los — sem isso, seus
		// stepPositions já limpos pelo throwFinished quebram o próximo roll.
		for (const d of this.diceList) {
			if (d && d.body_sim) d.body_sim.dead = true;
		}
		this.deadDiceList = this.deadDiceList.concat(this.diceList);
		this.diceList = [];
		// Física limpa AGORA (não só no clearAll 3s depois): corpos velhos
		// no mundo fazem os dados novos quicarem sem dormir até o teto de
		// 1000 iterações — e esse caminho sai sem setar iterationsNeeded,
		// o que travava a animação muda no clamp. Meshes continuam visíveis
		// (estáticos) até o clearAll; só a física é removida.
		for (const d of this.deadDiceList) {
			if (d && d.body_sim) {
				try { this.world_sim.remove(d.body_sim); } catch {}
				d.body_sim = null;
			}
		}
	}

	clearAll(){
		this.clearDice();
		let dice;
		while (dice = this.deadDiceList.pop()) {
			this.scene.remove(dice.parent.type == "Scene" ? dice:dice.parent); 
			if (dice.body_sim) this.world_sim.remove(dice.body_sim);
		}
		
		if (this.pane) this.scene.remove(this.pane);
		this.renderer.render(this.scene, this.camera);
		this.isVisible = false;

		//setTimeout(() => { this.renderer.render(this.scene, this.camera); }, 100);
	}

	rollDice(throws, callback){

		this.camera.position.z = this.cameraHeight.far;
		this.clearDice();
		this.minIterations = (throws.length-1) * this.nbIterationsBetweenRolls;

		for(let j = 0; j < throws.length; j++){
			let notationVectors = throws[j];
			this.applyColorsForRoll(notationVectors.dsnConfig);
			this.dicefactory.setSystem(notationVectors.dsnConfig.system);
			for (let i=0, len=notationVectors.dice.length; i < len; ++i) {
				notationVectors.dice[i].startAtIteration = j*this.nbIterationsBetweenRolls;
				this.spawnDice(notationVectors.dice[i]);
			}
		}
		this.iteration = 0;
		
		this.simulateThrow();
		// Fail-fast: se o sim não produziu dados (iterationsNeeded<=0), a
		// animação travaria muda no clamp com rolling preso. Pula esta
		// animação e libera a fila em vez de deadlockar os próximos rolls.
		if (!(this.iterationsNeeded > 0)) {
			console.warn('[dice-so-nice] sim sem dados válidos, pulando animação');
			this.clearDice();
			this.clearAll();
			this.rolling = false;
			if (callback) callback(this.throws);
			return;
		}
		this.iteration = 0;
		this.settle_time = 0;


		//check forced results, fix dice faces if necessary
		//Detect if there's an animated dice
		this.animatedDiceDetected = false;
		for (let i=0, len=this.diceList.length; i < len; ++i) {
			let dicemesh = this.diceList[i];
			if (!dicemesh) continue;
			this.swapDiceFace(dicemesh);
			if(dicemesh.mixer)	
				this.animatedDiceDetected = true;
		}

		//reset the result
		for (let i=0, len=this.diceList.length; i < len; ++i) {
			if (!this.diceList[i]) continue;
			if (this.diceList[i].resultReason != 'forced') {
				this.diceList[i].result = [];
			}
		}
		// animate the previously simulated roll
		this.rolling = true;
		this.running = (new Date()).getTime();
		this.last_time = 0;
		this.callback = callback;
		this.throws = throws;
		this._startLoop(this.animateThrow);
	}

	showcase(config) {
		this.clearAll();
		let activeSys = config.system || this.dicefactory.systemActivated || 'standard';
		if (this.dicefactory.systems[activeSys]) {
			this.dicefactory.setSystem(activeSys, true);
		}
		let step = this.display.containerWidth / 5 * 1.15;

		if (this.pane) this.scene.remove(this.pane);
		if (this.desk) this.scene.remove(this.desk);
		if (this.shadows) {
			let shadowplane = new THREE.ShadowMaterial();
			shadowplane.opacity = 0.5;

			this.pane = new THREE.Mesh(new THREE.PlaneGeometry(this.display.containerWidth * 6, this.display.containerHeight * 6, 1, 1), shadowplane);
			this.pane.receiveShadow = this.shadows;
			this.pane.position.set(0, 0, 1);
			this.scene.add(this.pane);
		}

		let sysDice = this.dicefactory.systems[activeSys]?.dice;
		let selectordice;
		if (sysDice && sysDice.length > 0 && activeSys !== 'standard') {
			selectordice = sysDice.map((d) => d.type);
		} else {
			selectordice = Object.keys(this.dicefactory.dice);
		}
		//remove the useless d3 and d5
		selectordice = selectordice.filter((die) => die !== 'd3' && die !== 'd5');
		this.camera.position.z = selectordice.length > 10 ? this.cameraHeight.far / 1.3 : this.cameraHeight.medium;
		let posxstart = selectordice.length > 10 ? -2.5 : (selectordice.length <= 4 ? -1.0 : -2.0);
		let posystart = selectordice.length > 10 ? 1 : 0.5;
		let poswrap = selectordice.length > 10 ? 3 : (selectordice.length <= 4 ? 1 : 2);
		this.applyColorsForRoll(config);
		for (let i = 0, posx = posxstart, posy = posystart; i < selectordice.length; ++i, ++posx) {

			if (posx > poswrap) {
				posx = posxstart;
				posy--;
			}

			let dicemesh = this.dicefactory.create(this.scopedTextureCache, selectordice[i]);
			if (!dicemesh) continue;
			dicemesh.position.set(posx * step, posy * step, step * 0.5);
			dicemesh.castShadow = this.shadows;
			dicemesh.userData = selectordice[i];

			this.diceList.push(dicemesh);
			this.scene.add(dicemesh);
		}

		this.last_time = 0;
		if (this.selector.animate) {
			this.container.style.opacity = 0;
			this._startLoop(this.animateSelector);
		}
		else this.renderer.render(this.scene, this.camera);
		setTimeout(() =>{
			this.scene.traverse(object => {
				if(object.type === 'Mesh') object.material.needsUpdate = true;
			});
		},2000);
	}

	animateSelector() {
		this.animstate = 'selector';
		let time = (new Date()).getTime();
		let time_diff = (time - this.last_time) / 1000;
		if (time_diff > 3) time_diff = this.framerate;

		if (this.container.style.opacity != '1') this.container.style.opacity = Math.min(1, (parseFloat(this.container.style.opacity) + 0.05));

		if (this.selector.rotate) {
			let angle_change = 0.005 * Math.PI;
			for (let i=0;i<this.diceList.length;i++) {
				this.diceList[i].rotation.y += angle_change;
				this.diceList[i].rotation.x += angle_change / 4;
				this.diceList[i].rotation.z += angle_change / 10;
			}
		}

		this.last_time = time;
		this.renderer.render(this.scene, this.camera);
	}
}
