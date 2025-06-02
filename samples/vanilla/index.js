// In vanilla JS, the `@digitalpersona/iwa` and `@digitalpersona/websdk` are
// imported using the `<script>` tag, and the `IWA` and `WebSdk` objects are
// available as global variables. Typings are available via the `<reference>`
// triple-slash directive (https://www.typescriptlang.org/docs/handbook/triple-slash-directives.html)

/// <reference types="@digitalpersona/face" />
/// <reference types="@digitalpersona/face/facefinder" />

// Little HTML helper
const $ = (selector, root) => typeof selector === "string" ?
    (root ?? document).querySelector(selector) :
    selector;

// HTML elements
const startButton = $("#start");
const stopButton  = $("#stop");
const samples = $("#samples");

const api = faceSDK;

// State variables
let capturing = false;
let deviceId;

startButton.onclick = startCapture;
stopButton.onclick = stopCapture;
// window.onload = startCapture;

// API event handlers and status updates

async function onProgress({code, message}) {
    console.log("onProgress", message);
    requestAnimationFrame(_ => setData($("#captureProgress"), { message }))
}

async function onSuccess(images) {
    console.log("onSuccess", images.length);
    setCaptureActive(false);
    for (const image of images)
        addItem(samples, { image });
}

async function onError(error) {
    setCaptureActive(false);
    handleError(error);
}

// Capture control methods and status updates

function setCaptureActive(active) {
    capturing = active;
    $("#captureControl").toggleAttribute("active", active);
}

async function stopCapture() {
    try {
        if (capturing) {
            api.stopVideo();
            // remember the last used camera; it will be a preferred one next time
            localStorage.setItem("lastCameraId", api.getLastCameraId() || "");
            setCaptureActive(false);
        }
    } catch (error) {
        handleError(error);
    }
}

async function startCapture() {
    try {
        clearItems(samples)

        const devices = await api.getAvailableDevices() || [];
        // exclude unlabeled and infra-red cameras
        const eligibleCameras = devices.filter(d => d.label && !d.label.includes("HP IR"));

        // prefer the last used camera (if it is still connected),
        // otherwise let the user choose, prioritizing user-facing cameras
        const lastCameraId = localStorage.getItem("lastCameraId");
        const lastCameras = eligibleCameras.filter(c => c.deviceId === lastCameraId);
        const selectCameraId = lastCameras.length > 0 ? lastCameras[0].deviceId : undefined;
        const constraints = {
            audio: false,
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                deviceId: selectCameraId ? { exact: selectCameraId } : undefined,
                facingMode: !selectCameraId ? { ideal: "user" } : undefined,
            }
        };

        api.init(
            $("#video"),
            constraints,
            $("#videoCanvas"),
            $("#detectionCanvas"),
            10,
            onSuccess,
            onError,
            onProgress,
            {
                detection: {
                    cascade: facefinder         // include facefinder.js into the HTML or bundle
                },
                visuals: {
                    frame: {
                        progressColor: "green",
                        thickness: 1.05,
                        density: 60,
                    }
            }}
        );
        setCaptureActive(true);
    } catch (error) {
        handleError(error);
    }
}

// Other status methods

function handleError(error) {
    $("#error").innerHTML = error?.message || error?.type || "";
}

// HTML view helpers

async function showDialog(id, defaultValue = {}) {
    return new Promise((resolve) => {
        const dialog = $(id);
        const form = $("*", dialog);
        form.reset();

        dialog.onclose = () => {
            const data = Object.fromEntries(new FormData(form).entries());
            resolve(dialog.returnValue === "ok" ? data : defaultValue);
        }
        dialog.showModal();
    });
}

// Data conversion functions

function hex(str) {
    return Array.from(str)
    .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
}

// Data transfer functions

const isControl = el => ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
const isMedia = el => ["IMG", "AUDIO", "VIDEO"].includes(el.tagName);

// Set data to HTML elements, using the `name` attribute as a JSON path
function setData(element, data) {
    for (let child of element.children) {
        if (child.hasAttribute('name')) {
            const jsonPath = child.getAttribute('name');
            let value = jsonPath.split('.').reduce((o, k) => (o || {})[k], data);
            if (typeof value === "object") value = JSON.stringify(value, null, 2);
            if (isControl(child)) {
                child.value = value;
            } else if (isMedia(child)) {
                child.src = value;
            } else {
                child.innerText = value;
            }
        }
        setData(child, data);
    }
}

// Item list functions

// Add an item to the list, using the `item-template` attribute as a template reference
// and the `name` attribute as a JSON path to set data
function addItem(list, itemData, afterInsert) {
    const container = $(list);
    const itemTemplate = $(container.getAttribute("item-template"));
    const node = itemTemplate.content.cloneNode(true);
    setData(node, itemData);
    container.insertBefore(node, container.firstChild);
    afterInsert ? afterInsert(container.firstElementChild) : void(0);
}

function clearItems(list) {
    const container = $(list);
    container.textContent = "";
}
