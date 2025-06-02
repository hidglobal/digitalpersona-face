// @ts-ignore
import facefinderData from './facefinder.bin'

declare global {
    interface Window {
        facefinder: ArrayBuffer;
    }

    var facefinder: ArrayBuffer;
}

window.facefinder = facefinderData.buffer;
