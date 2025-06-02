// useful articles
// MDN documentation
// http://tangiblejs.com/posts/viewing-webcam-feeds-and-grabbing-still-frames-in-a-modern-way

// face detection
// https://wesbos.com/html5-video-face-detection-canvas-javascript/
// https://github.com/wesbos/HTML5-Face-Detection

import { deepMerge, DeepPartial, defaultOptions, FaceSDKOptions } from './options.js';
import * as pico from './pico.js';

type Error = { code: number, message: string, name: string };
type Progress = { code: number, message: string };

type SuccessCallback = (images: string[]) => void;
type ErrorCallback = (error: Error) => void;
type ProgressCallback = (state: Progress) => void;

const circle = Math.PI * 2;
const quarter = Math.PI / 2;

let lastCameraId: string | undefined;

function die(message: string): never { throw new Error(message) }

export class FaceSDK
{
    private static current: FaceSDK;

    private started = false;
    private completed = false;
    private captured = false;
    private images: string[] = [];
    private globalAlpha = 0;        // holds a current mask opacity level; the mask progressively darkens when a face is detected
    private currentPercent = 0;
    private totalImageCount = 0;
    private stream?: MediaStream;
    private context: CanvasRenderingContext2D;
    private displayContext?: CanvasRenderingContext2D | null;
    private interval?: number;
    private timeout?: number;
    private facefinder_classify_region: pico.RegionClassifier = () => -1.0;;
    private update_memory: pico.DetectionUpdater;
    private mask = document.createElement('canvas');

    public videoElement: HTMLVideoElement;
    public constraints: MediaStreamConstraints;
    public captureCanvas: HTMLCanvasElement;     // image capture canvas. The size of the canvas defines the size of snapshots.
    public displayCanvas?: HTMLCanvasElement;    // user feedback canvas (optional). The size of the canvas defines what user will see on the screen during the capture process.
    public imageCount: number;                   // a number of snapshots to capture
    public successCB: SuccessCallback;
    public errorCB: ErrorCallback;
    public progressCB: ProgressCallback;
    public options: FaceSDKOptions;

    constructor(
        videoElement: HTMLVideoElement,
        constraints: MediaStreamConstraints,
        captureCanvas: HTMLCanvasElement,                // image capture canvas. The size of the canvas defines the size of snapshots.
        displayCanvas: HTMLCanvasElement | undefined,    // user feedback canvas (optional). The size of the canvas defines what user will see on the screen during the capture process.
        imageCount: number,                              // a number of snapshots to capture
        successCB: SuccessCallback,
        errorCB: ErrorCallback,
        progressCB: ProgressCallback,
        options?: DeepPartial<FaceSDKOptions>
    ){
        this.videoElement = videoElement || die("Missing <video> element");
        this.captureCanvas = captureCanvas || die("Missing <canvas> element for image capturing");
        this.constraints = constraints || { video: { facingMode: "user" } }; // default to user-facing camera
        this.displayCanvas = displayCanvas;
        this.imageCount = Math.min(imageCount, 1);
        this.successCB = successCB || die("Missing success callback");
        this.errorCB = errorCB || die("Missing error callback");
        this.progressCB = progressCB || die("Missing progress callback");
        this.options = deepMerge(defaultOptions, options || {}); // merge default options with provided ones

        if (!this.options.detection?.cascade) throw new Error("Missing cascade data");

        this.totalImageCount = imageCount;

        // Set the context we need for capturing image.
        this.context = this.captureCanvas.getContext("2d", { willReadFrequently: true }) || die("Cannot obtain 2d context from display canvas");
        this.displayContext = this.displayCanvas?.getContext("2d");
        // Clearing canvas Bug 60144 VYI authentication window shows previously authenticated FACE before authenticating current user face
        if (this.displayContext)
            this.displayContext?.clearRect(0, 0, this.displayContext.canvas.width, this.displayContext.canvas.height);

         // Combine detection from last 5 frames
        this.update_memory = pico.instantiate_detection_memory(5);
    }

    // Returns a list of all the video devices existing in users system (provided by browser)
    // If we need to use a specific device, use this in constraints where id is the actual deviceId.
    // video: { deviceId: { exact: id} }
    public static async getAvailableDevices(): Promise<MediaDeviceInfo[] | undefined> {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(item => item.kind === "videoinput");
            return videoDevices;
        } catch(error) { };
    };

    // Creates, starts and returns a capture process.
    // If there is already a capture process running, it will be stopped and replaced with the new one.
    // The capture process is associated with the video element (under media constraints)
    // and canvas elements used for displaying video and the captured image.
    public static init(
        videoElement: HTMLVideoElement,
        constraints: MediaStreamConstraints,
        canvas: HTMLCanvasElement,
        displayCanvas: HTMLCanvasElement,
        imageCount: number,
        successCallback: SuccessCallback,
        errorCallback: ErrorCallback,
        progressCallback: ProgressCallback,
        options?: DeepPartial<FaceSDKOptions>
    ): FaceSDK
    {
        FaceSDK.current?.stopVideo();
        FaceSDK.current =
            new FaceSDK(videoElement, constraints, canvas, displayCanvas, imageCount, successCallback, errorCallback, progressCallback, options);
        FaceSDK.current.start();
        return FaceSDK.current;
    };

    // Returns the last camera id used for the capture process.
    public static getLastCameraId(): string | undefined {
        return lastCameraId;
    };

    // Stops the video in the capture process created by the `init` static method.
    public static stopVideo(): void {
        FaceSDK.current?.stopRawFeed();
        FaceSDK.current?.stopVideo();
    }

    // this will start and ask user permission for accessing webcam.
    public async start(): Promise<void> {
        if (this.started) return;
        try {
            const cascade = this.options.detection.cascade || window.facefinder;
            const bytes = cascade instanceof Uint8Array ? cascade : new Uint8Array(cascade);
            this.facefinder_classify_region = pico.unpack_cascade(bytes);

            // obtain a camera vidoe stream
            this.progressCB(this.options.capture.states.starting);
            const stream = await navigator.mediaDevices.getUserMedia(this.constraints)
            this.progressCB(this.options.capture.states.havePermission);
            this.stream = stream;

            // bind the camera stream with the <video> element; the `autoplay` attribute should start the camera casting
            this.videoElement.srcObject = stream;

            // remember selected camera
            const tracks = stream.getTracks();
            lastCameraId = tracks[0].getSettings().deviceId;

            // start capturing (with a small delay)
            this.setCapturedTimeout();
            this.started = true;
            this.runTheLoop();
        }
        catch(error: any) {
            this.started = false;
            this.errorCB({
                code: error.code,
                message: error.message,
                name: error.name
            });
        };
    };

    // Start a raw video feed without face detection. Set `interval` to 0 for a live feed.
    public startRawFeed(interval = 100): void {
        this.interval = setInterval(() => {
            this.context.drawImage(this.videoElement, 0, 0, this.captureCanvas.width, this.captureCanvas.height);
        }, interval);
    };

    // Stop the raw feed.
    public stopRawFeed(): void {
        clearInterval(this.interval);
        delete this.interval;
    };

    // Returns the base64-encoded image, which we can use for further processing/ending to server.
    public getImageBase64(): string {
        return this.captureCanvas.toDataURL("image/jpeg", 1.0);
    };
    // public static getImageBase64() {
    //     faceSDK.current?.getImageBase64();
    // }

    // Stops all the video feed currently streaming.
    public stopVideo(): void {
        if (!this.started) return;
        this.started = false;
        const stream = this.videoElement.srcObject as MediaStream | null;
        stream?.getVideoTracks().forEach(track => track.stop());
    };

    // Tries to detect faces and periodically saves detected face into the `images` collection,
    // until the maximum number of detections made or a video is stopped.
    //
    private detectFace() {
        if (!this.stream || !this.stream.active) {
            this.progressCB(this.options.capture.states.inactive);
            this.setErrorTimeout();
            return;
        }
        const imageWidth = Math.min(this.videoElement.videoWidth, this.captureCanvas.width);
        const imageHeight = Math.min(this.videoElement.videoHeight, this.captureCanvas.height);
        if (!imageWidth || !imageHeight) return;

        FaceSDK.drawImage(this.videoElement, this.displayContext);
        FaceSDK.drawImage(this.videoElement, this.context);

        const rgba = this.context.getImageData(0, 0, this.captureCanvas.width, this.captureCanvas.height).data;
        // prepare input to `run_cascade`
        const image: pico.Image = {
            pixels: FaceSDK.rgba_to_grayscale(rgba, this.captureCanvas.height, this.captureCanvas.width),
            nrows: this.captureCanvas.height,
            ncols: this.captureCanvas.width,
            ldim: this.captureCanvas.width
        };

        // run the cascade over the image
        let dets = pico.run_cascade(image,
            this.facefinder_classify_region,
            this.options.detection.cascadeParams);

        // Combine detections from several frames to increase confidence a face is present
        dets = this.update_memory(dets);

        // cluster the obtained detections
        dets = pico.cluster_detections(dets, 0.2); // set IoU threshold to 0.2

        // Remove detections that are under threshold
        const detectedFaces = dets.filter(det => det[3] > this.options.detection.minScore);

        // If progress at 100% we are done
        if (this.completed && this.currentPercent >= 1) {
            this.stopVideo();
            this.successCB(this.images);
        }
        // Increase progress bar
        if (this.currentPercent < (this.images.length / this.totalImageCount)) {
            this.currentPercent += this.options.visuals.frame.progressDelta;
        }

        this.drawFaceMask(detectedFaces);

        if (detectedFaces.length === 0) {
            this.progressCB(this.options.capture.states.noFace);
            return;
        }

        // Found faces
        const multipleFaces = detectedFaces.length > 1;
        let incorrectSize = false;
        // Set state (ex. multiface, too small, too big)
        if (multipleFaces) {
            this.progressCB(this.options.capture.states.multiFace);
            this.setErrorTimeout();
        }
        else {
            const faceSize = detectedFaces[0][2];
            if (faceSize < this.options.capture.minFaceSize) {
                incorrectSize = true;
                this.progressCB(this.options.capture.states.tooSmall);
                this.setErrorTimeout();
            }
            else if (faceSize > this.options.capture.maxFaceSize) {
                incorrectSize = true;
                this.progressCB(this.options.capture.states.tooBig);
                this.setErrorTimeout();
            }
            else {
                this.progressCB(this.options.capture.states.ok);
            }
        }

        // Save image if only one face detected and enough time passed since the last capture or error
        if (!(multipleFaces || incorrectSize) && this.readyToCapture()) {
            this.saveImage(this.getImageBase64());
            this.setCapturedTimeout();
        }
    };

    // draw the image from the source to the dest, scaling down the image if needed
    private static drawImage(source: HTMLVideoElement | HTMLCanvasElement, dest: CanvasRenderingContext2D | null | undefined)
    {
        if (!dest) return;
        const sourceWidth = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
        const sourceHeight = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
        if (!sourceWidth || !sourceHeight) return;

        const xScale = Math.min(1.0, dest.canvas.width / sourceWidth);
        const yScale = Math.min(1.0, dest.canvas.height / sourceHeight);
        const scale = Math.min(xScale, yScale);

        const width = sourceWidth * scale;
        const height = sourceHeight * scale;

        dest.drawImage(source,
            0, 0, sourceWidth, sourceHeight,
            0, 0, width, height);
    }

    private drawFaceMask(faces: pico.Detection[]) {
        this.mask.width = this.captureCanvas.width;
        this.mask.height = this.captureCanvas.height;

        const maskContext = this.mask.getContext('2d');
        if (!maskContext) throw new Error("Failed to get mask context");

        // options
        const frame = this.options.visuals.frame;
        const backdrop = this.options.visuals.backdrop;
        const capture = this.options.capture;

        const multipleFaces = faces.length > 1;

        // progressively darken the mask when a single face is detected,
        // thus focusing attention on the face position and removing the background;
        // otherwise progressively restoring the transparency
        maskContext.globalAlpha = (faces.length === 1) ? this.increaseAlpha() : this.decreaseAlpha();

        // set transparent background
        maskContext.fillStyle = backdrop.color;
        maskContext.fillRect(0, 0, this.captureCanvas.width, this.captureCanvas.height);

        for (let face of faces) {
            const row = face[0], col = face[1], scale = face[2];
            const innerRadius = scale/2 * frame.scale;
            if (!multipleFaces) {
                // Transparent inner circle for detected face
                maskContext.globalCompositeOperation = 'destination-out';
                maskContext.arc(col, row, innerRadius, -quarter, -quarter + circle, false);
                maskContext.fill();
            }
            const incorrectSize = scale < capture.minFaceSize || scale > capture.maxFaceSize;
            // Reset composition and alpha for the face frame
            maskContext.globalCompositeOperation = 'source-over';
            maskContext.globalAlpha = 1.0;
            // Draw a circular dashed face frame
            const frameRadius = innerRadius * frame.thickness;
            const lineWidth = frameRadius - innerRadius;
            const dash = [frameRadius * circle/2 / frame.density];
            maskContext.beginPath();
            maskContext.arc(col, row, frameRadius, -quarter, -quarter + circle, false);
            maskContext.lineWidth = lineWidth;
            maskContext.setLineDash(dash);
            maskContext.strokeStyle = (multipleFaces || incorrectSize) ? frame.badFaceColor : frame.goodFaceColor;
            maskContext.stroke();
            // Draw a progress arc
            if (!(multipleFaces || incorrectSize)) {
                maskContext.beginPath();
                maskContext.arc(col, row, frameRadius, -quarter, -quarter + (circle * this.currentPercent), false);
                maskContext.lineWidth = lineWidth;
                maskContext.setLineDash(dash);
                maskContext.strokeStyle = frame.progressColor;
                maskContext.stroke();
            }
        }
        // Draw the final mask composition on the canvas
        FaceSDK.drawImage(this.mask, this.displayContext);
    }

    private runTheLoop() {
        const loop = () => {
            if (!this.started) return;
            this.detectFace();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    };

    private saveImage(image: string) {
        if (this.images.length < this.totalImageCount) {
            this.images.push(image);
        }
        if (this.images.length === this.totalImageCount && !this.completed) {
            this.completed = true;
        }
    };

    private static rgba_to_grayscale(rgba:  Uint8ClampedArray<ArrayBuffer>, nrows: number, ncols: number) {
        const gray = new Uint8Array(nrows * ncols);
        for (let r = 0; r < nrows; ++r) {
            for (let c = 0; c < ncols; ++c) {
                // gray = 0.2*red + 0.7*green + 0.1*blue
                gray[r * ncols + c] = (2 * rgba[r * 4 * ncols + 4 * c] + 7 * rgba[r * 4 * ncols + 4 * c + 1] + 1 * rgba[r * 4 * ncols + 4 * c + 2]) / 10;
            }
        }
        return gray;
    }

    private increaseAlpha() {
        if (this.globalAlpha < this.options.visuals.backdrop.maxOpacity) {
            this.globalAlpha = this.globalAlpha + this.options.visuals.backdrop.opacityDelta;
        }
        return this.globalAlpha
    }

    private decreaseAlpha() {
        if (this.globalAlpha > 0) {
            this.globalAlpha = this.globalAlpha - this.options.visuals.backdrop.opacityDelta;
        }
        if (this.globalAlpha < 0) {
            this.globalAlpha = 0;
        }
        return this.globalAlpha
    }

    private readyToCapture() {
        return !this.completed && !this.captured;
    }

    private setCapturedTimeout() {
        this.captured = true;
        this.timeout = setTimeout(() => {
            this.captured = false;
        }, this.options.capture.minDetectionInterval);
    }

    private setErrorTimeout() {
        this.captured = true;
        clearTimeout(this.timeout);
        this.timeout = setTimeout(() => {
            this.captured = false;
        }, this.options.capture.minErrorCooldownInterval);
    }

}

declare global {
    interface Window {
        faceSDK: typeof FaceSDK;
    }

    var faceSDK: typeof FaceSDK;
}

window.faceSDK = FaceSDK;
