// Continuous water surface for the 2D-slab fluid: splat particles into a density grid in (y, z),
// extract the filled iso-region with marching squares, and extrude it across the wheel width.
// Output is a real mesh (front/back caps + side walls with smooth normals), so it is depth-tested
// against the wheel buckets and lit like any other object.

import * as THREE from 'three';

const Y0 = 0.3, Z0 = -1.4, CELL = 0.05, NY = 112, NZ = 120;
const RAD = 0.12, RAD2 = RAD * RAD, SPAN = Math.ceil(RAD / CELL);
const ISO = 2.6;
const MAXV = 150000;

export class WaterSurface {
  constructor(parent, halfWidth = 0.6) {
    this.hw = halfWidth;
    this.d = new Float32Array(NY * NZ);
    this.pos = new Float32Array(MAXV * 3);
    this.nor = new Float32Array(MAXV * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.MeshStandardMaterial({ color: 0x3cc4d8, emissive: 0x15788c, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    parent.add(this.mesh);
    this.nv = 0;
  }

  /** pts: Float32Array [x, y, z] * n. Returns number of vertices written. */
  update(pts, n) {
    const d = this.d; d.fill(0);
    for (let i = 0; i < n; i++) {
      const y = pts[i * 3 + 1], z = pts[i * 3 + 2];
      const cy = Math.round((y - Y0) / CELL), cz = Math.round((z - Z0) / CELL);
      for (let a = cy - SPAN; a <= cy + SPAN; a++) {
        if (a < 0 || a >= NY) continue;
        const dy = Y0 + a * CELL - y;
        for (let b = cz - SPAN; b <= cz + SPAN; b++) {
          if (b < 0 || b >= NZ) continue;
          const dz = Z0 + b * CELL - z, r2 = dy * dy + dz * dz;
          if (r2 >= RAD2) continue;
          const w = 1 - r2 / RAD2; d[a * NZ + b] += w * w;
        }
      }
    }
    this.nv = this._mesh();
    this.geo.setDrawRange(0, this.nv);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
    return this.nv;
  }

  _grad(a, b) { // outward normal in (y, z) from density gradient
    const d = this.d, a0 = Math.max(0, a - 1), a1 = Math.min(NY - 1, a + 1), b0 = Math.max(0, b - 1), b1 = Math.min(NZ - 1, b + 1);
    const gy = d[a1 * NZ + b] - d[a0 * NZ + b], gz = d[a * NZ + b1] - d[a * NZ + b0];
    const l = Math.hypot(gy, gz) || 1;
    return [-gy / l, -gz / l];
  }

  _mesh() {
    const { d, pos, nor, hw } = this;
    let nv = 0;
    const tri = (ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz) => {
      if (nv + 3 > MAXV) return;
      let o = nv * 3;
      pos[o] = ax; pos[o + 1] = ay; pos[o + 2] = az; pos[o + 3] = bx; pos[o + 4] = by; pos[o + 5] = bz; pos[o + 6] = cx; pos[o + 7] = cy; pos[o + 8] = cz;
      for (let k = 0; k < 3; k++) { nor[o + k * 3] = nx; nor[o + k * 3 + 1] = ny; nor[o + k * 3 + 2] = nz; }
      nv += 3;
    };
    const triN = (A, B, C, nA, nB, nC) => {
      if (nv + 3 > MAXV) return;
      const o = nv * 3, P = [A, B, C], N = [nA, nB, nC];
      for (let k = 0; k < 3; k++) { pos[o + k * 3] = P[k][0]; pos[o + k * 3 + 1] = P[k][1]; pos[o + k * 3 + 2] = P[k][2]; nor[o + k * 3] = N[k][0]; nor[o + k * 3 + 1] = N[k][1]; nor[o + k * 3 + 2] = N[k][2]; }
      nv += 3;
    };
    // cell corners, counter-clockwise in (a, b): (a,b) (a+1,b) (a+1,b+1) (a,b+1)
    const ca = [0, 1, 1, 0], cb = [0, 0, 1, 1];
    const vs = []; // polygon vertices: {y, z, cross, ga, gb}
    for (let a = 0; a < NY - 1; a++) {
      for (let b = 0; b < NZ - 1; b++) {
        const v0 = d[a * NZ + b], v1 = d[(a + 1) * NZ + b], v2 = d[(a + 1) * NZ + b + 1], v3 = d[a * NZ + b + 1];
        if (v0 < ISO && v1 < ISO && v2 < ISO && v3 < ISO) continue;
        const vals = [v0, v1, v2, v3];
        vs.length = 0;
        for (let k = 0; k < 4; k++) {
          const k2 = (k + 1) & 3, in1 = vals[k] >= ISO, in2 = vals[k2] >= ISO;
          const y1 = Y0 + (a + ca[k]) * CELL, z1 = Z0 + (b + cb[k]) * CELL;
          if (in1) vs.push({ y: y1, z: z1, c: false });
          if (in1 !== in2) {
            const t = (ISO - vals[k]) / (vals[k2] - vals[k]);
            const y2 = Y0 + (a + ca[k2]) * CELL, z2 = Z0 + (b + cb[k2]) * CELL;
            vs.push({ y: y1 + (y2 - y1) * t, z: z1 + (z2 - z1) * t, c: true });
          }
        }
        const m = vs.length; if (m < 3) continue;
        // caps (fan)
        for (let k = 1; k < m - 1; k++) {
          const A = vs[0], B = vs[k], C = vs[k + 1];
          tri(hw, A.y, A.z, hw, B.y, B.z, hw, C.y, C.z, 1, 0, 0);
          tri(-hw, A.y, A.z, -hw, C.y, C.z, -hw, B.y, B.z, -1, 0, 0);
        }
        // side walls along cut edges (consecutive crossing vertices)
        for (let k = 0; k < m; k++) {
          const A = vs[k], B = vs[(k + 1) % m];
          if (!A.c || !B.c) continue;
          const na = this._grad(a, b), nrm = [0, na[0], na[1]];
          const P1 = [-hw, A.y, A.z], P2 = [hw, A.y, A.z], P3 = [hw, B.y, B.z], P4 = [-hw, B.y, B.z];
          triN(P1, P2, P3, nrm, nrm, nrm); triN(P1, P3, P4, nrm, nrm, nrm);
        }
      }
    }
    return nv;
  }
}
