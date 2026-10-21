import { prepareMmdAsset } from './mmdPreparationData.js';
self.onmessage = ({ data: { type, payload } }) => {
  try {
    const { transfer, ...result } = prepareMmdAsset(type, payload);
    self.postMessage({ result }, transfer);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
