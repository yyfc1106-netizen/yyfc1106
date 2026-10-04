// Screen-space fluid rendering (van der Laan et al. 2009):
//   1. render the scene to an offscreen target (colour + depth)
//   2. draw particles as sphere impostors into a float depth target (nearest sphere wins)
//   3. splat particle thickness additively
//   4. bilateral-blur the depth so spheres merge into a smooth surface
//   5. composite: normals from depth, Beer-Lambert absorption, refraction, Fresnel, specular
// Returns null from create() when the GPU cannot render to float/half-float targets.

import * as THREE from 'three';

const POINT_VERT = /* glsl */ `
  uniform float uRadius, uScale; varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = mv.xyz;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(2.0 * uRadius * uScale / max(0.05, -mv.z), 1.0, 256.0);
  }`;

const POINT_COMMON = /* glsl */ `
  #include <packing>
  uniform sampler2D tSceneDepth; uniform vec2 uRes; uniform float uNear, uFar, uRadius; uniform mat4 uProj;
  varying vec3 vView;
  float sceneZ() { return perspectiveDepthToViewZ(texture2D(tSceneDepth, gl_FragCoord.xy / uRes).x, uNear, uFar); }
`;

const DEPTH_FRAG = POINT_COMMON + /* glsl */ `
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0; float r2 = dot(c, c); if (r2 > 1.0) discard;
    vec3 p = vView + vec3(c.x, -c.y, sqrt(1.0 - r2)) * uRadius;
    if (p.z < sceneZ() - 0.03) discard;            // behind opaque geometry
    vec4 clip = uProj * vec4(p, 1.0);
    gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
    gl_FragColor = vec4(-p.z, 0.0, 0.0, 1.0);
  }`;

const THICK_FRAG = POINT_COMMON + /* glsl */ `
  uniform float uThick;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0; float r2 = dot(c, c); if (r2 > 1.0) discard;
    vec3 p = vView + vec3(c.x, -c.y, sqrt(1.0 - r2)) * uRadius;
    if (p.z < sceneZ() - 0.03) discard;
    gl_FragColor = vec4(2.0 * sqrt(1.0 - r2) * uRadius * uThick, 0.0, 0.0, 1.0);
  }`;

const QUAD_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BLUR_FRAG = /* glsl */ `
  uniform sampler2D tDepth; uniform vec2 uDir, uRes; uniform float uWorldR, uScale;
  varying vec2 vUv;
  void main() {
    float d = texture2D(tDepth, vUv).r;
    if (d <= 0.0) { gl_FragColor = vec4(0.0); return; }
    float rad = clamp(uWorldR * uScale / d, 1.0, 24.0);
    float sum = 0.0, wsum = 0.0;
    for (int i = -6; i <= 6; i++) {
      float f = float(i) / 6.0;
      float s = texture2D(tDepth, vUv + uDir * (f * rad) / uRes).r;
      if (s <= 0.0) continue;
      float dz = (s - d) / 0.06;
      float w = exp(-f * f * 2.0) * exp(-dz * dz);
      sum += s * w; wsum += w;
    }
    gl_FragColor = vec4(sum / wsum, 0.0, 0.0, 1.0);
  }`;

const COMP_FRAG = /* glsl */ `
  uniform sampler2D tColor, tFluid, tThick, tSceneDepth;
  uniform mat4 uProjInv, uViewInv; uniform vec2 uRes; uniform vec3 uSky, uLight, uDeep, uAbsorb; uniform float uHas; uniform vec3 uBg;
  varying vec2 vUv;
  vec3 viewPos(vec2 uv, float d) { vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, -1.0, 1.0); p.xyz /= p.w; return p.xyz * (d / -p.z); }
  float fl(vec2 uv, float fallback) { float d = texture2D(tFluid, uv).r; return d > 0.0 ? d : fallback; }
  void main() {
    vec3 scene = texture2D(tColor, vUv).rgb;
    float d = uHas > 0.5 ? texture2D(tFluid, vUv).r : 0.0;
    vec3 col = scene;
    if (d > 0.0) {
      vec2 px = 1.0 / uRes;
      vec3 P = viewPos(vUv, d);
      vec3 Pr = viewPos(vUv + vec2(px.x, 0.0), fl(vUv + vec2(px.x, 0.0), d)), Pl = viewPos(vUv - vec2(px.x, 0.0), fl(vUv - vec2(px.x, 0.0), d));
      vec3 Pu = viewPos(vUv + vec2(0.0, px.y), fl(vUv + vec2(0.0, px.y), d)), Pd = viewPos(vUv - vec2(0.0, px.y), fl(vUv - vec2(0.0, px.y), d));
      vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
      vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
      vec3 n = normalize(cross(dx, dy));
      float t = texture2D(tThick, vUv).r;
      vec3 V = normalize(-P), L = normalize(uLight);
      vec2 off = n.xy * 0.035 * clamp(t, 0.0, 1.5);
      vec3 refr = texture2D(tColor, clamp(vUv + off, 0.001, 0.999)).rgb;
      vec3 trans = exp(-uAbsorb * t);
      float lit = 0.55 + 0.45 * max(dot(n, L), 0.0);
      vec3 body = refr * trans + uDeep * lit * (1.0 - exp(-t * 1.6));
      float F = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
      vec3 wn = normalize(mat3(uViewInv) * n);
      vec3 env = mix(uSky * 0.7, uSky * 1.25 + 0.08, wn.y * 0.5 + 0.5);
      col = mix(body, env, clamp(F * 0.85, 0.0, 1.0));
      vec3 H = normalize(L + V);
      col += vec3(1.0) * pow(max(dot(n, H), 0.0), 140.0) * 1.4;
      // thin water edges fade into the scene so droplets do not look pasted on
      col = mix(scene, col, smoothstep(0.0, 0.25, t));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    if (texture2D(tSceneDepth, vUv).x > 0.99999) gl_FragColor.rgb = uBg; // keep the page background exactly as the UI colour
    #include <colorspace_fragment>
  }`;

export class ScreenSpaceFluid {
  static create(renderer) {
    const gl = renderer.getContext();
    const half = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
    if (!renderer.capabilities.isWebGL2 || !half) return null;
    try { return new ScreenSpaceFluid(renderer); } catch (e) { console.warn('SSF unavailable', e); return null; }
  }

  constructor(renderer) {
    this.r = renderer;
    this.radius = 0.095;
    this.floatDepth = renderer.extensions.has('EXT_color_buffer_float');
    this.size = new THREE.Vector2(1, 1);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);

    const rtOpts = (type) => ({ type, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    const depthType = this.floatDepth ? THREE.FloatType : THREE.HalfFloatType;
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, samples: 0 });
    this.sceneRT.depthTexture = new THREE.DepthTexture(1, 1);
    this.depthRT = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts(depthType), depthBuffer: true });
    this.blurA = new THREE.WebGLRenderTarget(1, 1, rtOpts(depthType));
    this.blurB = new THREE.WebGLRenderTarget(1, 1, rtOpts(depthType));
    this.thickRT = new THREE.WebGLRenderTarget(1, 1, rtOpts(THREE.HalfFloatType));

    const shared = () => ({
      tSceneDepth: { value: this.sceneRT.depthTexture }, uRes: { value: this.size }, uNear: { value: 0.1 }, uFar: { value: 200 },
      uRadius: { value: this.radius }, uScale: { value: 1 }, uProj: { value: new THREE.Matrix4() },
    });
    this.depthMat = new THREE.ShaderMaterial({ uniforms: shared(), vertexShader: POINT_VERT, fragmentShader: DEPTH_FRAG });
    this.thickMat = new THREE.ShaderMaterial({
      uniforms: { ...shared(), uThick: { value: 1.0 } }, vertexShader: POINT_VERT, fragmentShader: THICK_FRAG,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null }, uDir: { value: new THREE.Vector2() }, uRes: { value: this.size }, uWorldR: { value: 0.1 }, uScale: { value: 1 } },
      vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false,
    });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.sceneRT.texture }, tSceneDepth: { value: this.sceneRT.depthTexture }, uBg: { value: new THREE.Color(0xe9ecfb) }, tFluid: { value: null }, tThick: { value: this.thickRT.texture },
        uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() }, uRes: { value: this.size },
        uSky: { value: new THREE.Color(0.8, 0.85, 0.95) }, uLight: { value: new THREE.Vector3(0.4, 0.8, 0.45) },
        uDeep: { value: new THREE.Color(0.05, 0.62, 0.72) }, uAbsorb: { value: new THREE.Vector3(2.0, 0.55, 0.32) }, uHas: { value: 0 },
      },
      vertexShader: QUAD_VERT, fragmentShader: COMP_FRAG, depthTest: false, depthWrite: false,
    });
    this.sunDir = new THREE.Vector3(8, 14, 6).normalize();
    this.clear = new THREE.Color(0, 0, 0);
  }

  setSky(c) { this.compMat.uniforms.uSky.value.set(c); this.compMat.uniforms.uBg.value.set(c); }

  _resize(w, h) {
    if (this.size.x === w && this.size.y === h) return;
    this.size.set(w, h);
    [this.sceneRT, this.depthRT, this.blurA, this.blurB, this.thickRT].forEach((rt) => rt.setSize(w, h));
  }

  /** points: THREE.Points with the fluid sphere centres (world space); count: number of drawn points. */
  render(scene, camera, points, count) {
    const r = this.r, v = r.getDrawingBufferSize(new THREE.Vector2());
    this._resize(v.x, v.y);
    const prevTarget = r.getRenderTarget(), prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha(), prevAuto = r.autoClear;

    const pointsWasVisible = points.visible; points.visible = false;
    r.setRenderTarget(this.sceneRT); r.clear(); r.render(scene, camera);
    points.visible = pointsWasVisible;

    const has = count > 0;
    this.compMat.uniforms.uHas.value = has ? 1 : 0;
    if (has) {
      const scale = v.y * 0.5 * camera.projectionMatrix.elements[5];
      for (const m of [this.depthMat, this.thickMat]) {
        m.uniforms.uScale.value = scale; m.uniforms.uNear.value = camera.near; m.uniforms.uFar.value = camera.far;
        m.uniforms.uProj.value.copy(camera.projectionMatrix); m.uniforms.uRadius.value = this.radius;
      }
      const prevMat = points.material;
      r.setClearColor(this.clear, 0); r.autoClear = false;
      points.material = this.depthMat; points.visible = true;
      r.setRenderTarget(this.depthRT); r.clear(); r.render(points, camera);
      points.material = this.thickMat;
      r.setRenderTarget(this.thickRT); r.clear(); r.render(points, camera);
      points.material = prevMat; points.visible = pointsWasVisible;

      // bilateral blur, ping-pong; the result ends up in blurA
      let src = this.depthRT;
      this.blurMat.uniforms.uScale.value = scale;
      for (let i = 0; i < 3; i++) {
        for (const dir of [[1, 0], [0, 1]]) {
          const dst = src === this.blurA ? this.blurB : this.blurA;
          this.blurMat.uniforms.tDepth.value = src.texture; this.blurMat.uniforms.uDir.value.set(dir[0], dir[1]);
          this.quad.material = this.blurMat; r.setRenderTarget(dst); r.render(this.quadScene, this.quadCam);
          src = dst;
        }
      }
      this.compMat.uniforms.tFluid.value = src.texture;
      this.compMat.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
      this.compMat.uniforms.uViewInv.value.copy(camera.matrixWorld);
      this.compMat.uniforms.uLight.value.copy(this.sunDir).transformDirection(camera.matrixWorldInverse);
    }
    r.setRenderTarget(null);
    this.quad.material = this.compMat; r.render(this.quadScene, this.quadCam);
    r.setRenderTarget(prevTarget); r.setClearColor(prevClear, prevAlpha); r.autoClear = prevAuto;
  }
}
