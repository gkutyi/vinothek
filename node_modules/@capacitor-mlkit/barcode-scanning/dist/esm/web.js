import { CapacitorException, ExceptionCode, WebPlugin } from '@capacitor/core';
import { BarcodeValueType, LensFacing } from './definitions';
export class BarcodeScannerWeb extends WebPlugin {
    constructor() {
        super(...arguments);
        this._isSupported = 'BarcodeDetector' in window;
        this.errorVideoElementMissing = 'videoElement must be provided.';
        this.eventBarcodesScanned = 'barcodesScanned';
    }
    async startScan(options) {
        if (!this._isSupported) {
            throw this.createUnimplementedException();
        }
        if (!(options === null || options === void 0 ? void 0 : options.videoElement)) {
            throw new Error(this.errorVideoElementMissing);
        }
        this.videoElement = options.videoElement;
        this.stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: {
                    ideal: (options === null || options === void 0 ? void 0 : options.lensFacing) === LensFacing.Front ? 'user' : 'environment',
                },
            },
            audio: false,
        });
        options.videoElement.srcObject = this.stream;
        await options.videoElement.play();
        const barcodeDetector = new BarcodeDetector();
        this.intervalId = window.setInterval(async () => {
            if (!options.videoElement) {
                return;
            }
            const barcodes = await barcodeDetector.detect(options.videoElement);
            if (barcodes.length === 0) {
                return;
            }
            else {
                this.handleScannedBarcodes(barcodes);
            }
        }, 500);
    }
    async stopScan() {
        if (!this._isSupported) {
            throw this.createUnimplementedException();
        }
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = undefined;
        }
        if (this.videoElement) {
            this.videoElement.srcObject = null;
            this.videoElement = undefined;
        }
    }
    async readBarcodesFromImage(_options) {
        throw this.createUnimplementedException();
    }
    async scan() {
        throw this.createUnimplementedException();
    }
    async isSupported() {
        return { supported: this._isSupported };
    }
    async enableTorch() {
        throw this.createUnimplementedException();
    }
    async disableTorch() {
        throw this.createUnimplementedException();
    }
    async toggleTorch() {
        throw this.createUnimplementedException();
    }
    async isTorchEnabled() {
        throw this.createUnimplementedException();
    }
    async isTorchAvailable() {
        return { available: false };
    }
    async setZoomRatio(_options) {
        throw this.createUnimplementedException();
    }
    async getZoomRatio() {
        throw this.createUnimplementedException();
    }
    async getMinZoomRatio() {
        throw this.createUnimplementedException();
    }
    async getMaxZoomRatio() {
        throw this.createUnimplementedException();
    }
    async openSettings() {
        throw this.createUnimplementedException();
    }
    async isGoogleBarcodeScannerModuleAvailable() {
        throw this.createUnimplementedException();
    }
    async installGoogleBarcodeScannerModule() {
        throw this.createUnimplementedException();
    }
    async checkPermissions() {
        try {
            const result = await navigator.permissions.query({
                name: 'camera',
            });
            return {
                camera: result.state,
            };
        }
        catch (error) {
            return {
                camera: 'prompt',
            };
        }
    }
    async requestPermissions() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach(track => track.stop());
            return {
                camera: 'granted',
            };
        }
        catch (error) {
            return {
                camera: 'denied',
            };
        }
    }
    createUnimplementedException() {
        return new CapacitorException('This method is not implemented on web.', ExceptionCode.Unimplemented);
    }
    handleScannedBarcodes(barcodes) {
        const result = {
            barcodes: barcodes.map(barcode => ({
                cornerPoints: [
                    [barcode.cornerPoints[0].x, barcode.cornerPoints[0].y],
                    [barcode.cornerPoints[1].x, barcode.cornerPoints[1].y],
                    [barcode.cornerPoints[2].x, barcode.cornerPoints[2].y],
                    [barcode.cornerPoints[3].x, barcode.cornerPoints[3].y],
                ],
                displayValue: barcode.rawValue,
                rawValue: barcode.rawValue,
                format: barcode.format.toUpperCase(),
                valueType: BarcodeValueType.Unknown,
            })),
        };
        this.notifyListeners(this.eventBarcodesScanned, result);
    }
}
//# sourceMappingURL=web.js.map