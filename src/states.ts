export type ProgressState = {
    code: number;          // state code
    message: string;       // state message
}

export interface ProgressStates {
    starting: ProgressState;
    ok: ProgressState;
    tooSmall: ProgressState;
    tooBig: ProgressState;
    havePermission: ProgressState;
    noFace: ProgressState;
    multiFace: ProgressState;
    inactive: ProgressState;
}


export const defaultStates: ProgressStates = {
    starting: {
        code: 0,
        message: "Opening a camera..."
    },
    ok: {
        code: 1,
        message: "Face is detected"
    },
    tooSmall: {
        code: 2,
        message: "Face is too far"
    },
    tooBig: {
        code: 3,
        message: "Face is too close"
    },
    havePermission: {
        code: 4,
        message: "Camera permission ok"
    },
    noFace: {
        code: 6,
        message: "No face detected"
    },
    multiFace: {
        code: 7,
        message: "Multiple faces detected"
    },
    inactive: {
        code: 8,
        message: "Media stream is not active"
    }
};
