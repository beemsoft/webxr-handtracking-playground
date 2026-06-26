import {
    CanvasTexture,
    DoubleSide,
    LinearFilter,
    Mesh,
    PlaneGeometry,
    RawShaderMaterial
} from 'three';

/**
 * A Performance Stats Viewer for WebXR, inspired by the immersive-web samples.
 * Uses a CanvasTexture to draw FPS values and a scrolling graph.
 */
export class StatsMesh {

    private width: number;
    private height: number;
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private texture: CanvasTexture;
    private material: RawShaderMaterial;
    mesh: Mesh;

    private readonly segments = 30;
    private readonly maxFps = 90;
    private fpsHistory: number[] = [];
    private lastSegment = 0;

    constructor(maxAnisotropy: number, width: number = 512, height: number = 256) {
        this.width = width;
        this.height = height;

        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');

        this.canvas.width = this.width;
        this.canvas.height = this.height;

        this.texture = new CanvasTexture(this.canvas);
        this.texture.generateMipmaps = false;
        this.texture.anisotropy = maxAnisotropy;
        this.texture.minFilter = LinearFilter;
        this.texture.magFilter = LinearFilter;

        this.material = new RawShaderMaterial({
            uniforms: {
                opacity: { value: 1 },
                map: { value: this.texture }
            },
            side: DoubleSide,
            transparent: true,
            vertexShader: `attribute vec3 position;
attribute vec2 uv;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

varying vec2 vUv;

void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,
            fragmentShader: `precision highp float;

uniform sampler2D map;
uniform float opacity;

varying vec2 vUv;

void main() {
	vec4 c = texture2D( map, vUv );
	c.a *= opacity;
	if( c.a == 0. ) discard;
	gl_FragColor = c;
}`,
            wireframe: false
        });

        const w = width / 512;
        const h = height / 512;
        this.mesh = new Mesh(new PlaneGeometry(w, h), this.material);

        // Initialize history
        for (let i = 0; i < this.segments; i++) {
            this.fpsHistory.push(0);
        }

        this.initialDraw();
    }

    private initialDraw() {
        this.draw(0);
    }

    private fpsToY(fps: number): number {
        return this.height - (Math.min(fps, this.maxFps) / this.maxFps) * (this.height * 0.7) - (this.height * 0.05);
    }

    private fpsToColor(fps: number): string {
        const r = Math.floor(Math.max(0, Math.min(255, 255 * (1 - fps / 60))));
        const g = Math.floor(Math.max(0, Math.min(255, 255 * (fps / 90))));
        const b = Math.floor(Math.max(0, Math.min(255, 255 * (fps / 90))));
        return `rgb(${r},${g},${b})`;
    }

    update(fps: number) {
        this.fpsHistory[this.lastSegment] = fps;
        this.lastSegment = (this.lastSegment + 1) % this.segments;
        this.draw(fps);
    }

    private draw(currentFps: number) {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        // Background
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, w, h);

        // FPS Text
        ctx.font = 'bold 48px Roboto, Arial';
        ctx.fillStyle = '#00FF00';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(`${currentFps} FPS`, 10, 10);

        // Graph area background
        const graphTop = h * 0.3;
        const graphHeight = h * 0.65;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(10, graphTop, w - 20, graphHeight);

        // Guide lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        [30, 60, 90].forEach(level => {
            const y = this.fpsToY(level);
            ctx.beginPath();
            ctx.moveTo(10, y);
            ctx.lineTo(w - 10, y);
            ctx.stroke();
        });

        // Graph bars
        const barWidth = (w - 20) / this.segments;
        for (let i = 0; i < this.segments; i++) {
            const index = (this.lastSegment + i) % this.segments;
            const fps = this.fpsHistory[index];
            if (fps > 0) {
                const barHeight = (Math.min(fps, this.maxFps) / this.maxFps) * graphHeight;
                const x = 10 + i * barWidth;
                const y = h - 10 - barHeight;

                ctx.fillStyle = this.fpsToColor(fps);
                ctx.fillRect(x, y, barWidth - 1, barHeight);
            }
        }

        // Current progress indicator (like the green line in samples)
        const indicatorX = 10 + ((this.lastSegment) % this.segments) * barWidth;
        ctx.fillStyle = '#00FF00';
        ctx.fillRect(indicatorX, graphTop, 2, graphHeight);

        this.texture.needsUpdate = true;
    }
}
