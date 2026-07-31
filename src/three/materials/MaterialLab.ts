import * as THREE from 'three'
import { surface, applyAoUv, type MaterialPreset } from './procedural'

/**
 * Standalone material inspector — `/matlab.html`.
 *
 * Lays every preset out as a lit sphere + tilted plane pair under a three-point
 * rig so the maps can be judged for micro-detail, roughness response and
 * silhouette-catching normals without booting the whole game.
 */

const PRESETS: MaterialPreset[] = [
  'concrete', 'polishedConcrete', 'asphalt', 'brushedMetal',
  'paintedMetal', 'darkSteel', 'rustedSteel', 'marble',
  'wornWood', 'plywood', 'rubberFloor', 'carpet',
  'fabric', 'plaster', 'drywall', 'glassPanel',
  'carbonFibre', 'perforatedMetal', 'cardboard', 'whiteboard',
]

const COLS = 5
const SPACING = 2.6

function label(text: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 96
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(0,0,0,0)'
  g.fillRect(0, 0, 512, 96)
  g.font = 'bold 52px ui-monospace, Menlo, monospace'
  g.fillStyle = '#fff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, 256, 52)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }))
  s.scale.set(2.2, 0.41, 1)
  return s
}

export function mountMaterialLab(host: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
  renderer.setSize(host.clientWidth, host.clientHeight)
  renderer.toneMapping = THREE.AgXToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x14161a)

  const rows = Math.ceil(PRESETS.length / COLS)
  const camera = new THREE.PerspectiveCamera(38, host.clientWidth / host.clientHeight, 0.1, 200)
  const spanX = (COLS - 1) * SPACING
  const spanY = (rows - 1) * SPACING
  camera.position.set(spanX / 2, -spanY / 2 + 1.2, Math.max(spanX, spanY) * 1.35 + 4)
  camera.lookAt(spanX / 2, -spanY / 2, 0)

  // A neutral studio environment so metals and glass have something to reflect.
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envScene = new THREE.Scene()
  const grad = document.createElement('canvas')
  grad.width = 4; grad.height = 256
  const gg = grad.getContext('2d')!
  const lg = gg.createLinearGradient(0, 0, 0, 256)
  lg.addColorStop(0, '#cfe0f0')
  lg.addColorStop(0.5, '#8b98a8')
  lg.addColorStop(1, '#2b3038')
  gg.fillStyle = lg
  gg.fillRect(0, 0, 4, 256)
  const envTex = new THREE.CanvasTexture(grad)
  envTex.mapping = THREE.EquirectangularReflectionMapping
  envTex.colorSpace = THREE.SRGBColorSpace
  envScene.background = envTex
  scene.environment = pmrem.fromScene(envScene).texture

  const key = new THREE.DirectionalLight(0xfff2e0, 2.6)
  key.position.set(6, 8, 7)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x88a8ff, 0.7)
  fill.position.set(-7, 3, 4)
  scene.add(fill)
  const rim = new THREE.DirectionalLight(0xffffff, 1.6)
  rim.position.set(-2, 4, -8)
  scene.add(rim)
  scene.add(new THREE.AmbientLight(0x404a58, 0.5))

  const sphereGeo = applyAoUv(new THREE.SphereGeometry(0.72, 96, 64))
  const planeGeo = applyAoUv(new THREE.PlaneGeometry(1.9, 1.15, 1, 1))

  PRESETS.forEach((preset, i) => {
    const cx = (i % COLS) * SPACING
    const cy = -Math.floor(i / COLS) * SPACING

    const mat = surface(preset, { repeat: 2, seed: 7 })
    const sphere = new THREE.Mesh(sphereGeo, mat)
    sphere.position.set(cx - 0.42, cy + 0.18, 0)
    sphere.castShadow = true
    scene.add(sphere)

    const plane = new THREE.Mesh(planeGeo, surface(preset, { repeat: 3, seed: 7 }))
    plane.position.set(cx + 0.5, cy - 0.05, -0.5)
    plane.rotation.set(-0.42, 0.5, 0)
    plane.receiveShadow = true
    scene.add(plane)

    const l = label(preset)
    l.position.set(cx, cy - 1.02, 0.4)
    scene.add(l)
  })

  let frame = 0
  const loop = () => {
    frame++
    renderer.render(scene, camera)
    requestAnimationFrame(loop)
  }
  loop()

  const onResize = () => {
    renderer.setSize(host.clientWidth, host.clientHeight)
    camera.aspect = host.clientWidth / host.clientHeight
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', onResize)

  ;(window as unknown as { __MATLAB__: unknown }).__MATLAB__ = {
    ready: () => frame > 4,
  }
}
