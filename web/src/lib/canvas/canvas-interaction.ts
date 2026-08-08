export function shouldStartCanvasPan({ button, isBackgroundClick, isSpacePressed }: { button: number; isBackgroundClick: boolean; isSpacePressed: boolean }) {
    return button === 1 || (button === 0 && (isBackgroundClick || isSpacePressed));
}

export function shouldDeselectAfterCanvasPan({ hasMoved, startedOnBackground }: { hasMoved: boolean; startedOnBackground: boolean }) {
    return !hasMoved && startedOnBackground;
}
