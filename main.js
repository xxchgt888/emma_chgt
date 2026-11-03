<!DOCTYPE html>
<html lang="en">

<head>
    <title>three.js webgl - buffergeometry - lines drawrange</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, user-scalable=no, minimum-scale=1.0, maximum-scale=1.0">
    <link type="text/css" rel="stylesheet" href="main.css">
    <!-- Roboto fallback (optional) -->
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
    <script type="module" src="https://cdn.jsdelivr.net/npm/@google/model-viewer/dist/model-viewer.min.js"></script>
    <script async src="https://ga.jspm.io/npm:es-module-shims@1.10.0/dist/es-module-shims.js"></script>
    <script src="/socket.io/socket.io.js"></script>

    <style>
        /* Load local font files (place in examples/fonts/) */
        @font-face {
            font-family: 'Kirsty';
            src: 
                url('./fonts/Kirsty Rg.otf') format('truetype');
            font-weight: 100 900;
            font-style: normal;
            font-display: swap;
        }

        body {
            background: #ffffff;
            margin: 0;
        }

        /* allow pointer events on labels so clicks reach label DOM handlers */
        .label {
            pointer-events: auto;
            background: rgba(255, 255, 255, 0);
            font-family: 'Kirsty', 'Consolas', Courier, sans-serif;
            font-weight: 700;
        }
    </style>
</head>

<body>
    <div id="container"></div>
    <script type="importmap-shim">
            {
                "imports": {
                    "three": "../build/three.module.js",
                    "three/addons/": "./jsm/"
                }
            }
        </script>

    <script type="module-shim">
        // Initialize Socket.IO
        const socket = io();

        import * as THREE from 'three';

        import Stats from 'three/addons/libs/stats.module.js';
        import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
        let gui;
        

        import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
        import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
        import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

        let group;
        let container, stats;
        container = document.querySelector("#container");

        // labels are static in this example (movement/velocity logic removed)
        let camera, scene, renderer;
        let controls;
        let labels = []; // CSS2DObject list
        let labelRenderer;
        let items = [];
        // Map pour retrouver rapidement les labels via leur id
        const labelIndex = new Map();

        let raycaster, mouse = [];
        let additionalInfoVisible = false; // Track if additional info is currently shown
        
        // Track camera state to detect changes
        let lastCameraPosition = new THREE.Vector3();
        let lastCameraTarget = new THREE.Vector3();
        let cameraStateInitialized = false;
        const CAMERA_MOVEMENT_THRESHOLD = 50; // Hide info only if camera moves more than 50 units
        
        // Camera movement vector for zooming
        const direction = new THREE.Vector3();
        const scrollSpeed = 5; // ajuster la vitesse de zoom

        // Layout and appearance parameters for spiral
        const effectController = {
            showLabels: true,

            spiralTurns: 3,         // Number of spiral rotations for hubs
            titleGroupGap: 300,     // Distance from center to category hubs (hub radius)
            levelGap: 400,          // Spacing between spiral arms (spiral spacing)
            labelSpread: 2.0,       // Spread of labels around each hub
            angularGap: 2.0,        // Arc angle for label distribution

            titleZOffset: 1200,     // Z offset for hubs (depth)
            categoryGroupGap: 400,  // Radial gap for category level
            categoryZOffset: 400,   // Z offset for category level
            titleChildZStep: 200,   // Z step for child labels (title group)
            categoryChildZStep: 200,// Z step for child labels (category group)
            labelZScale: 1.0,        // Z scaling for label stacking
            zPerTurn: 200          //  extra Z per full turn
        };


        // Start by loading label data then initialize
        fetch('./labels.json').then(res => res.json()).then(data => {
            window.__labelData = data; // keep globally for debug
            init();
        }).catch(err => {
            console.error('Could not load labels.json', err);
            // Fallback to empty/auto-generated labels if fetch fails
            window.__labelData = null;
            init();
        });

        /**
         * Create and configure the on-screen GUI (lil-gui).
         * Wires UI controls to `effectController` and shows/hides labels
         * and legend controls used to tweak layout and appearance.
         */
        function initGUI() {

            gui = new GUI();

            gui.add(effectController, 'showLabels').onChange(function (value) {
                labels.forEach(s => s.element.style.display = value ? '' : 'none');
            });
            // Spiral layout controls
            gui.add(effectController, 'spiralTurns', 1, 8, 1)
                .name('Spiral turns')
                .onChange(() => applyLayout()); // Number of spiral rotations
            gui.add(effectController, 'titleGroupGap', 50, 800, 1)
                .name('Hub radius')
                .onChange(() => applyLayout()); // Distance from center to category hubs
            gui.add(effectController, 'levelGap', 50, 800, 1)
                .name('Spiral spacing')
                .onChange(() => applyLayout()); // Spacing between spiral arms
            gui.add(effectController, 'labelSpread', 0.1, 2.0, 0.01)
                .name('Label spread')
                .onChange(() => applyLayout()); // Spread of labels around each hub
            gui.add(effectController, 'angularGap', 0.1, 3.0, 0.01)
                .name('Arc sweep')
                .onChange(() => applyLayout()); // Arc angle for label distribution
            gui.add(effectController, 'zPerTurn', -2000, 2000, 1)
                .name('Z per turn')
                .onChange(() => applyLayout());

        }

        /**
         * Initialize the scene, camera, controls, label renderer,
         * create particle anchors/labels/pick meshes and start the
         * animation loop. Called after label data is loaded.
         */
        function init() {

            initGUI();

            container = document.getElementById('container');

            // increase camera.far so deeper Z positions remain visible
            camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 80000);
            camera.position.z = 3000;

            controls = new OrbitControls(camera, container);
            // controls.minDistance = 1;
            // controls.maxDistance = 600000;
            // controls.zoomToCursor = true;   // zoom where the mouse points
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;
            controls.enableZoom = false;


            scene = new THREE.Scene();

            group = new THREE.Group();
            scene.add(group);

            // Create CSS2D labels (text) based on loaded JSON or fallback
            const labelData = window.__labelData;
            items = [];
            if (Array.isArray(labelData) && labelData.length > 0) {
                items = labelData;
            } else {
                // fallback: generate demo items with categories A/B/C
                for (let i = 0; i < 100; i++) {
                    items.push({ text: 'Item ' + i, category: ['A', 'B', 'C'][Math.floor(Math.random() * 3)] });
                }
            }

            // create CSS2DRenderer and label DOMs
            labelRenderer = new CSS2DRenderer();
            labelRenderer.setSize(window.innerWidth, window.innerHeight);
            labelRenderer.domElement.style.position = 'absolute';
            labelRenderer.domElement.style.top = '0px';
            labelRenderer.domElement.style.pointerEvents = 'auto';
            // keep labels above the WebGL canvas but below GUI controls
            labelRenderer.domElement.style.zIndex = '2';

            function createLabelElement(text, imageUrl, id, paragraphe, citation, url, thumbnailImage, model) {
                const container = document.createElement('div');
                container.className = 'label-container';
                container.style.display = 'flex';
                container.style.flexDirection = 'column';
                container.style.alignItems = 'center';
                container.dataset.labelId = id;

                // Create text label
                const textDiv = document.createElement('h2');
                textDiv.className = 'label';
                textDiv.style.padding = '2px 6px';
                textDiv.style.color = '#000000';
                textDiv.style.textShadow = '0 1px 0 rgba(0,0,0,0.06)';
                textDiv.style.fontFamily = "'Kirsty Rg', 'Consolas', Courier, sans-serif";
                textDiv.style.fontWeight = '700';
                textDiv.style.fontSize = '14px';
                textDiv.style.maxWidth = '300px';
                textDiv.style.whiteSpace = 'normal';
                textDiv.style.wordWrap = 'break-word';
                textDiv.style.lineHeight = '1.4';
                textDiv.textContent = text;
                container.appendChild(textDiv);

                // Add GIF if provided
                if (imageUrl) {
                    const urls = Array.isArray(imageUrl) ? imageUrl : [imageUrl];
                    urls.forEach(url => {
                        const img = document.createElement('img');
                        img.src = url;
                        img.style.width = '64px';
                        img.style.height = 'auto';
                        img.style.marginTop = '8px';
                        img.style.borderRadius = '4px';
                        img.style.pointerEvents = 'auto';
                        img.dataset.labelId = id;
                        container.appendChild(img);
                    });
                }

                if(model) {
                    const modelViewer = document.createElement('model-viewer');
                    modelViewer.className = 'label-model';
                    modelViewer.style.opacity = '0';
                    modelViewer.src = model;
                    // modelViewer.style.width = '150px';
                    // modelViewer.style.height = '150px';
                    // modelViewer.style.marginTop = '8px';
                    // modelViewer.style.borderRadius = '4px';
                    modelViewer.setAttribute('bounds', 'tight');
                    modelViewer.setAttribute('field-of-view', 'auto');
                    modelViewer.setAttribute('auto-rotate', '');
                    modelViewer.setAttribute('disable-zoom', '');
                    modelViewer.setAttribute('camera-controls', '');
                    modelViewer.setAttribute('interaction-prompt', 'none');
                    // modelViewer.setAttribute('ar', '');
                    modelViewer.dataset.labelId = id;
                    container.appendChild(modelViewer);
                }

                if (paragraphe) {
                    const paraDiv = document.createElement('p');
                    paraDiv.className = 'label-paragraphe';
                    paraDiv.style.padding = '4px 6px';
                    paraDiv.style.color = '#000000';
                    paraDiv.style.fontFamily = "'Kirsty Rg', 'Consolas', Courier, sans-serif";
                    paraDiv.style.fontWeight = '400';
                    paraDiv.style.fontSize = '12px';
                    paraDiv.style.marginTop = '6px';
                    paraDiv.style.textAlign = 'center';
                    paraDiv.style.maxWidth = '200px';
                    paraDiv.style.whiteSpace = 'normal';
                    paraDiv.style.wordWrap = 'break-word';
                    paraDiv.style.lineHeight = '1.4';
                    
                    // Handle array of paragraphs or single paragraph
                    if (Array.isArray(paragraphe)) {
                        paragraphe.forEach((line, index) => {
                            if (index > 0) paraDiv.appendChild(document.createElement('br'));
                            paraDiv.appendChild(document.createTextNode(line));
                        });
                    } else {
                        paraDiv.textContent = paragraphe;
                    }
                    
                    paraDiv.style.opacity = '0';
                    container.appendChild(paraDiv);
                }

                // Add thumbnail image if provided (appears after paragraph)
                if (thumbnailImage) {
                    const thumbnailImages = Array.isArray(thumbnailImage) ? thumbnailImage : [thumbnailImage];
                   const thumbnailDiv = document.createElement ('div');
                    thumbnailDiv.className = 'label-thumbnail';
                    thumbnailDiv.style.marginTop = '8px';
                    thumbnailDiv.style.opacity = '0';
                    
                    
                    thumbnailImages.forEach(thumbnailImage => {

                    const thumbnailImg = document.createElement('img');
                    thumbnailImg.src = thumbnailImage;
                    thumbnailImg.style.width = '120px';
                    thumbnailImg.style.height = 'auto';
                    thumbnailImg.style.borderRadius = '4px';
                    thumbnailImg.style.boxShadow = '0 2px 4px rgba(0,0,0,0.0)';
                    thumbnailImg.style.pointerEvents = 'auto';
                    thumbnailImg.dataset.labelId = id;
                    
                    thumbnailDiv.appendChild(thumbnailImg);
                    });
                    container.appendChild(thumbnailDiv);
                }

                if(citation) {
                    const citeDiv = document.createElement('div');
                    citeDiv.className = 'label-citation';
                    citeDiv.style.padding = '4px 6px';
                    citeDiv.style.color = '#000000';
                    citeDiv.style.fontFamily = "'Kirsty Rg', 'Consolas', Courier, sans-serif";
                    citeDiv.style.fontWeight = '300';
                    citeDiv.style.fontSize = '12px';
                    citeDiv.style.marginTop = '4px';
                    citeDiv.style.fontStyle = 'italic';
                    citeDiv.textContent = citation;
                    citeDiv.style.opacity = '0';
                    container.appendChild(citeDiv);
                }

                if(url) {
                    const urlDiv = document.createElement('div');
                    urlDiv.className = 'label-url';
                    urlDiv.style.padding = '4px 6px';
                    urlDiv.style.marginTop = '4px';
                    urlDiv.style.opacity = '0';
                    
                    // Function to get custom name for each URL
                    function getUrlDisplayName(url) {
                        if (url.includes('journals.openedition.org')) return 'OpenEdition Journals';
                        if (url.includes('sunders.uber.space')) return 'Sunders Project';
                        if (url.includes('archive.org')) return 'Archive.org - US Hydrogen Test';
                        return url; // Fallback to showing the URL if no custom name
                    }
                    
                    const linkElement = document.createElement('a');
                    linkElement.href = url;
                    linkElement.target = '_blank'; // Open in new tab
                    linkElement.style.color = '#000000';
                    linkElement.style.fontFamily = "'Kirsty Rg', 'Consolas', Courier, sans-serif";
                    linkElement.style.fontWeight = '300';
                    linkElement.style.fontSize = '12px';
                    linkElement.style.fontStyle = 'italic';
                    linkElement.style.textDecoration = 'underline';
                    linkElement.textContent = getUrlDisplayName(url);
                    linkElement.addEventListener('click', (e) => {
                        e.stopPropagation(); // Prevent the label click event
                    });
                    
                    urlDiv.appendChild(linkElement);
                    container.appendChild(urlDiv);
                }

                

                return container;
            }
            console.log('labels with model:', items.filter(x => x && x.model).length);
            console.log('example model path:', items.find(x => x && x.model)?.model);
            // anchors: small invisible objects that act as exact 3D anchors for labels and raycasting
            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                const cat = it.category;
                const keys = Array.isArray(cat) ? cat.slice() : [cat];

                const el = createLabelElement(
                    it.text || ('Item ' + i),
                    it.image, // Pass the image URL from your JSON data
                    it.id || ('Id ' + i), // Pass the id from your JSON data
                    it.paragraphe, // Pass the paragraphe from your JSON data
                    it.citation, // Pass the citation from your JSON data
                    it.url, // Pass the url from your JSON data
                    it.thumbnailImage, // Pass the thumbnailImage from your JSON data
                    it.model // Pass the 3D model URL from your JSON data
                );
                const labelObj = new CSS2DObject(el);
                //scene.add(labelObj);

                // create a tiny invisible anchor mesh positioned at the label position
                const anchor = new THREE.Mesh(
                    new THREE.PlaneGeometry(5, 5, 1, 1),
                    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
                );
                // attach label to anchor so DOM label exactly follows anchor's projected position
                anchor.add(labelObj);
                anchor.userData = {
                    clickable: true,
                    index: i,
                    text: it.text || ('Item ' + i),
                    //category: Array.isArray(it.category) ? it.category : [it.category]
                };


                labelObj.userData.category = keys; // always store as array
                labelObj.userData.index = i;
                group.add(anchor);
                labels.push(labelObj);

                // default cursor to hint clickability
                labelObj.element.style.cursor = "pointer";

                // 🔸 Enregistre dans la Map
                labelIndex.set(it.id, { anchor, css2d: labelObj });

            }

            // debug: report created labels and pick meshes
            console.log('Labels created:', labels.length);

            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setClearColor(0xffffff);
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setSize(container.clientWidth, container.clientHeight);
            renderer.setAnimationLoop(animate);
            container.appendChild(renderer.domElement);
            // append label renderer after the WebGL canvas so labels are on top
            container.appendChild(labelRenderer.domElement);

            stats = new Stats();
            container.appendChild(stats.dom);

            applyLayout();

            window.addEventListener('resize', onWindowResize);
            
            container.addEventListener(
                'wheel', 
                (event) => {
                // Prevent the default scrolling behavior
                    event.preventDefault();

                    // Calculate the direction vector from camera to controls target
                    direction.subVectors(controls.target, camera.position).normalize();

                    // Move the camera and controls target along the direction vector
                    const moveAmount =-event.deltaY * scrollSpeed;
                    const offset = direction.clone().multiplyScalar(moveAmount);
                    controls.target.add(offset);
                    camera.position.add(offset);

                    // Update controls to reflect changes
                    controls.update();
            },
             { passive: false })

            raycaster = new THREE.Raycaster();
            mouse = new THREE.Vector2();

            // Listen for a click event on the label renderer's DOM element
            labelRenderer.domElement.addEventListener('pointerdown', (e) => {
                const el = e.target.closest('[data-label-id]');
                if (!el) return;
                const id = el.dataset.labelId;
                console.log('Clicked label (DOM):', id);
                e.stopPropagation(); // évite OrbitControls/raycast
                zoomToLabel(id, { duration: 1000, padding: 1.4 }); // 👈 déclenche le zoom

                // Emit to Socket.IO - send the entire DOM element HTML and children
                const labelContainer = e.target.closest('.label-container');
                if (labelContainer) {
                    socket.emit('label-clicked', {
                        id: id,
                        html: labelContainer.outerHTML
                    });
                }
            });


        }

        /**
         * Handle window resize events.
         * Updates camera and renderer sizes.
         */
        function onWindowResize() {

            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();

            renderer.setSize(window.innerWidth, window.innerHeight);

            if (labelRenderer) labelRenderer.setSize(window.innerWidth, window.innerHeight);

        }

        /**
         * Arrange labels by category using a spiral layout.
         * Positions category hubs and their items in 3D space.
         */
       
        function applyLayout() {
            if (!labels || labels.length === 0) return;

            const n = labels.length;
            const turns = Math.max(1, effectController.spiralTurns);

            const totalTheta = 2 * Math.PI * turns;
            const thetaStep = n > 1 ? totalTheta / (n - 1) : 0;

            const b = effectController.levelGap / (2 * Math.PI); // radial growth per turn

            // Base Z offset and vertical scaling per turn
            const baseZ = -effectController.titleZOffset;
            const zStep = effectController.titleChildZStep * effectController.labelZScale;
            const zPerTurn = effectController.zPerTurn || 100; // extra Z per full turn

            for (let i = 0; i < n; i++) {
                const lbl = labels[i];
                const anchor = lbl && lbl.parent ? lbl.parent : null;
                if (!anchor) continue;

                const theta = i * thetaStep;
                const r = b * theta;

                const x = r * Math.cos(theta);
                const y = r * Math.sin(theta);

                // Add gentle upward/downward Z offset as spiral grows
                const turnProgress = theta / (2 * Math.PI); // how many turns completed
                const z = baseZ + turnProgress * zPerTurn + (i * 0.05) * zStep;

                anchor.position.set(x, y, z);
                anchor.userData.baseZ = z;
            }
        }
        




        /**
         * Main animation loop. Applies layout, renders scene, and updates stats.
         */
        function animate() {

            // Check for camera changes to hide additional info
            if (additionalInfoVisible && controls) {
                if (!cameraStateInitialized) {
                    // Initialize camera state tracking
                    lastCameraPosition.copy(camera.position);
                    lastCameraTarget.copy(controls.target);
                    cameraStateInitialized = true;
                } else {
                    // Check if camera moved significantly (using distance threshold)
                    const positionDistance = camera.position.distanceTo(lastCameraPosition);
                    const targetDistance = controls.target.distanceTo(lastCameraTarget);
                    
                    if (positionDistance > CAMERA_MOVEMENT_THRESHOLD || targetDistance > CAMERA_MOVEMENT_THRESHOLD) {
                        hideAdditionalInfo();
                        // Update last known camera state
                        lastCameraPosition.copy(camera.position);
                        lastCameraTarget.copy(controls.target);
                    }
                }
            }

            render();
            if (labelRenderer) labelRenderer.render(scene, camera);

            stats.update();

        }

        // util easing
        function easeInOutCubic(t) {
            return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        }

        let camTween = null; // pour annuler un tween en cours

        /**
         * Animate camera to focus on a node index (or its group centroid).
         */
        function zoomToLabel(id, { duration = 1000, padding = 1.5 } = {}) {
            const activeLabel = labelIndex.get(id);
            if (!activeLabel || !activeLabel.anchor) {
                console.warn('zoomToLabel: anchor introuvable pour', id);
                return;
            }

            // 1) Cible = centre monde de l’anchor
            const target = new THREE.Vector3();
            new THREE.Box3().setFromObject(activeLabel.anchor).getCenter(target);

            // 2) Taille monde de l’anchor
            const box = new THREE.Box3().setFromObject(activeLabel.anchor);
            const size = new THREE.Vector3();
            box.getSize(size);

            // 3) Distance idéale pour “fit” dans le navigateur (en tenant compte de l’aspect)
            let distance;
            if (camera.isPerspectiveCamera) {
                const vFOV = THREE.MathUtils.degToRad(camera.fov);
                const fitHeight = size.y / (2 * Math.tan(vFOV / 2));
                const fitWidth = (size.x / (2 * Math.tan(vFOV / 2))) / camera.aspect;
                distance = Math.max(fitHeight, fitWidth, size.z) * padding || 1.0;
            } else {
                // Orthographic: on se contente d'une distance relative (maintient le radius actuel)
                distance = camera.position.distanceTo(controls ? controls.target : target);
            }

            // 4) Conserver l’angle actuel de vue (OrbitControls) et juste ajuster le radius
            const startPos = camera.position.clone();
            const startTarget = (controls ? controls.target.clone() : target.clone());

            // rayon/angle actuels
            const spherical = new THREE.Spherical();
            const offset = new THREE.Vector3().subVectors(camera.position, (controls ? controls.target : target));
            spherical.setFromVector3(offset);

            // nouvelle position en gardant theta/phi identiques, juste le radius
            const endTarget = target.clone();
            const endPos = new THREE.Vector3().setFromSpherical(new THREE.Spherical(distance, spherical.phi, spherical.theta)).add(endTarget);

            // 5) tween rAF
            if (camTween) cancelAnimationFrame(camTween.raf);
            const t0 = performance.now();
            const start = { p: startPos.clone(), t: startTarget.clone() };

            // désactiver controls pendant l’anim
            const hadControls = !!controls;
            if (hadControls) controls.enabled = false;

            function step(now) {
                const dt = Math.min(1, (now - t0) / duration);
                const k = easeInOutCubic(dt);

                // lerp position & target
                const currPos = start.p.clone().lerp(endPos, k);
                const currTgt = start.t.clone().lerp(endTarget, k);

                camera.position.copy(currPos);
                if (hadControls) {
                    controls.target.copy(currTgt);
                    controls.update();
                } else {
                    camera.lookAt(currTgt);
                }

                if (dt < 1) {
                    camTween.raf = requestAnimationFrame(step);
                } else {
                    // fin
                    if (hadControls) {
                        controls.enabled = true;
                        controls.target.copy(endTarget);
                        controls.update();
                    } else {
                        camera.lookAt(endTarget);
                    }
                    camTween = null;
                    
                    // Show additional info only after zoom animation is complete
                    showAdditionalInfo(id);
                }
            }

            camTween = { raf: requestAnimationFrame(step) };
        }

        function showAdditionalInfo(id) {
            const activeLabel = labelIndex.get(id);
            if (!activeLabel) return;
            const it = items[activeLabel.css2d.userData.index];
            if (!it) return;

            console.log('Informations supplémentaires pour', it);
            
            // Make the paragraph visible by setting opacity to 1
            const labelElement = activeLabel.css2d.element;
            const paragraphElement = labelElement.querySelector('.label-paragraphe');
            const citationElement = labelElement.querySelector('.label-citation');
            const urlElement = labelElement.querySelector('.label-url');
            const thumbnailElement = labelElement.querySelector('.label-thumbnail');
            const modelElement = labelElement.querySelector('.label-model');
            
            if (paragraphElement) {
                paragraphElement.style.opacity = '1';
            }
            if (citationElement) {
                citationElement.style.opacity = '1';
            }
            if (urlElement) {
                urlElement.style.opacity = '1';
            }
            if (thumbnailElement) {
                thumbnailElement.style.opacity = '1';
            }
            if (modelElement) {
                modelElement.style.opacity = '1';
            }
            
            // Set flag to start camera change detection in animate loop if any element was shown
            if (paragraphElement || citationElement || urlElement || thumbnailElement || modelElement) {
                additionalInfoVisible = true;
                // Reset camera state tracking to start fresh
                cameraStateInitialized = false;
            }
        };

        function hideAdditionalInfo() {
            // Hide all paragraph elements by setting opacity back to 0
            labels.forEach(label => {
                const paragraphElement = label.element.querySelector('.label-paragraphe');
                if (paragraphElement) {
                    paragraphElement.style.opacity = '0';
                }
                const citationElement = label.element.querySelector('.label-citation');
                if (citationElement) {
                    citationElement.style.opacity = '0';
                }
                const urlElement = label.element.querySelector('.label-url');
                if (urlElement) {
                    urlElement.style.opacity = '0';
                }
                const thumbnailElement = label.element.querySelector('.label-thumbnail');
                if (thumbnailElement) {
                    thumbnailElement.style.opacity = '0';
                }
                const modelElement = label.element.querySelector('.label-model');
                if (modelElement) {
                    modelElement.style.opacity = '0';
                }
            });
            
            // Reset the flag to stop camera change detection
            additionalInfoVisible = false;
        }

        /**
         * Render the WebGL scene for the current camera state.
         * Label rendering is handled separately in the animation loop.
         */
        function render() {
            renderer.render(scene, camera);
        }

    </script>
</body>

</html>
