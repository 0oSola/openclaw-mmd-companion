export function shouldCaptureStagePointer({
  enableCharacterClickCapture,
  button,
}: {
  enableCharacterClickCapture: boolean;
  button: number;
}): boolean {
  return enableCharacterClickCapture && button === 0;
}
