import type { TimelineTrack } from "../../shared/timeline";

export type ReviewVideoUniforms = {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  sharpness: number;
  denoise: number;
};

export function getReviewVideoUniforms(track?: TimelineTrack): ReviewVideoUniforms {
  return {
    brightness: Math.max(-1, Math.min(1, (track?.brightness ?? 0) / 100)),
    contrast: Math.max(0.5, Math.min(2, (track?.contrast ?? 100) / 100)),
    saturation: Math.max(0, Math.min(2, (track?.saturation ?? 100) / 100)),
    temperature: Math.max(-1, Math.min(1, (track?.temperature ?? 0) / 100)),
    tint: Math.max(-1, Math.min(1, (track?.tint ?? 0) / 100)),
    sharpness: Math.max(0, Math.min(1, (track?.sharpness ?? 0) / 100)),
    denoise: Math.max(0, Math.min(1, (track?.denoise ?? 0) / 100))
  };
}

export function needsReviewVideoCompositor(track?: TimelineTrack) {
  return Boolean(track && (track.sharpness !== 0 || track.denoise !== 0));
}

const vertexShader = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`;

const fragmentShader = `
precision mediump float;
uniform sampler2D u_frame;
uniform vec2 u_texel;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_temperature;
uniform float u_tint;
uniform float u_sharpness;
uniform float u_denoise;
varying vec2 v_texCoord;
void main() {
  vec3 center = texture2D(u_frame, v_texCoord).rgb;
  vec3 neighbors =
    texture2D(u_frame, v_texCoord + vec2(u_texel.x, 0.0)).rgb +
    texture2D(u_frame, v_texCoord - vec2(u_texel.x, 0.0)).rgb +
    texture2D(u_frame, v_texCoord + vec2(0.0, u_texel.y)).rgb +
    texture2D(u_frame, v_texCoord - vec2(0.0, u_texel.y)).rgb;
  vec3 blur = (center * 4.0 + neighbors) / 8.0;
  vec3 color = mix(center, blur, u_denoise * 0.62);
  color += (color - blur) * u_sharpness * 1.35;
  color = (color - 0.5) * u_contrast + 0.5 + u_brightness * 0.45;
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, u_saturation);
  color += vec3(u_temperature * 0.10, -abs(u_temperature) * 0.015, -u_temperature * 0.10);
  color += vec3(u_tint * 0.035, -u_tint * 0.055, u_tint * 0.035);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL shader allocation failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "WebGL shader compile failed");
  return shader;
}

export function startReviewVideoCompositor(canvas: HTMLCanvasElement, video: HTMLVideoElement, track?: TimelineTrack) {
  if (!needsReviewVideoCompositor(track)) return () => undefined;
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return () => undefined;
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, powerPreference: "high-performance" });
  if (!gl) return () => undefined;
  const program = gl.createProgram();
  if (!program) return () => undefined;
  try {
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexShader));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentShader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "WebGL program link failed");
  } catch {
    return () => undefined;
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, -1, -1, 0, 1, 1, 1, 1, 0, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_position");
  const texCoord = gl.getAttribLocation(program, "a_texCoord");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(texCoord);
  gl.vertexAttribPointer(texCoord, 2, gl.FLOAT, false, 16, 8);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const uniforms = getReviewVideoUniforms(track);
  const set = (name: string, value: number) => gl.uniform1f(gl.getUniformLocation(program, name), value);
  set("u_brightness", uniforms.brightness);
  set("u_contrast", uniforms.contrast);
  set("u_saturation", uniforms.saturation);
  set("u_temperature", uniforms.temperature);
  set("u_tint", uniforms.tint);
  set("u_sharpness", uniforms.sharpness);
  set("u_denoise", uniforms.denoise);
  let stopped = false;
  let frame = 0;
  const draw = () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(gl.getUniformLocation(program, "u_texel"), 1 / canvas.width, 1 / canvas.height);
      }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      canvas.dataset.webglReady = "true";
    }
    frame = window.requestAnimationFrame(draw);
  };
  frame = window.requestAnimationFrame(draw);
  return () => {
    stopped = true;
    window.cancelAnimationFrame(frame);
    delete canvas.dataset.webglReady;
    if (texture) gl.deleteTexture(texture);
    if (buffer) gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
  };
}
