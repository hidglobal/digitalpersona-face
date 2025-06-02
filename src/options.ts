import * as pico from './pico.js';
import { defaultStates, ProgressStates } from './states.js';

// TODO: pass the options into FaceSDK constructor
export type FaceSDKOptions =
{
    // Face detection parameters
    detection: {
        cascade: ArrayBuffer | Uint8Array;  // a face recognition cascade data
        cascadeParams: pico.CascadeParams;  // cascade parameters
        minScore: number;                   // a minimal detection score.
    },
    // Parameters for the face capture
    capture: {
        minFaceSize: number;                // minimal admittable face size, in pixels
        maxFaceSize: number;                // maximal admittable face size, in pixels
        minDetectionInterval: number;       // minimal time between consequitive scans, in milliseconds
        minErrorCooldownInterval: number;   // time to resume detections after an error, in milliseconds
        states: ProgressStates;             // capture progress states and messages
    },
    // Visual parameters of the capture UI
    visuals: {
        // Backdrop is a visual effect of covering image background with a semi-transparent mask,
        // while leaving the face fully visible
        backdrop: {
            color: string;              // backdrop color (default is black)
            opacityDelta: number;       // smoothness of the backdrop opacity change; lower the value -- smoother change
            maxOpacity: number;         // maximal opacity of the backdrop, from 0 (fully transparent) to 1 (fully opaque)
        },
        // The face frame is a visual effect adding a circle line (solid or dashed) around the face,
        // with a color coding reflecting the detection status and capture progress
        frame: {
            badFaceColor: string;       // color of the detection frame for a bad face
            goodFaceColor: string;      // color of the detection frame for a good face
            progressColor: string;      // color of the progress strip;
            scale: number;              // size of a detection frame relative to the face
            thickness: number;          // thickness of a detection frame relative to its size
            density: number;            // number of dashes in the detection frame;
            progressDelta: number;      // smoothness of the progress bar growth; lower value -- smoother change
        },
    },
}

export const defaultOptions: FaceSDKOptions = {
    detection: {
        minScore: 100,
        cascade: window.facefinder, // the facefinder cascade data, loaded from the facefinder.bin file
        cascadeParams: {
            shiftfactor: 0.1,       // move the detection window by 10% of its size
            minsize: 60,            // minimum size of a face (impacts performance, smaller means more processing)
            maxsize: 1000,          // maximum size of a face
            scalefactor: 1.1        // for multiscale processing: resize the detection window by 10% when moving to the higher scale
        },
    },
    capture: {
        minFaceSize: 150,
        maxFaceSize: 300,
        minDetectionInterval: 500,
        minErrorCooldownInterval: 2000,
        states: defaultStates,
    },
    visuals: {
        backdrop: {
            color: "black",
            opacityDelta: 0.025,
            maxOpacity: 0.7,
        },
        frame: {
            goodFaceColor: "#d3d3d3",
            badFaceColor: "#d31d20",
            progressColor: "#337ab7",
            progressDelta: 0.02,
            scale: 1.5,
            thickness: 1.1,
            density: 30,
        },
    }
}

export type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object
        ? DeepPartial<T[P]>
        : T[P];
};

function isPOJO(obj: any) {
      if (typeof obj !== 'object' || obj === null) {
        return false;
      }
      const proto = Object.getPrototypeOf(obj);
      return proto === null || proto === Object.prototype;
}

/**
 * Deeply merges two objects, giving precedence to properties from `second`.
 * Returns a new object of the same type as `first`.
 */
export function deepMerge<T>(first: T, second: DeepPartial<T>): T {
    const result = { ...first };

    for (const key in second) {
        if (second[key] !== undefined) {
            result[key] = (isPOJO(second[key]) && isPOJO(first[key])) ?
                deepMerge(first[key], second[key] as any) :
                second[key] as T[typeof key];
        }
    }

    return result;
}
