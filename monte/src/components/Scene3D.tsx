import * as THREE from 'three'
import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { useCursor, MeshReflectorMaterial, Image } from '@react-three/drei'
import { easing } from 'maath'

// Adaptado do demo MIT pmndrs/examples "image-gallery": molduras + clique-pra-focar
// (easing de camera) + chao reflexivo. Camada 3D pura: so recebe {id,url} e avisa o foco.
const GR = 1.61803398875

export interface FrameData {
  id: string
  url: string | null
  position: [number, number, number]
  rotation: [number, number, number]
}

export function Scene3D({
  frames,
  focusedId,
  onFocus,
}: {
  frames: FrameData[]
  focusedId: string | null
  onFocus: (id: string | null) => void
}) {
  return (
    <Canvas dpr={[1, 1.5]} camera={{ fov: 70, position: [0, 2, 15] }} gl={{ alpha: true, antialias: true }}>
      <color attach="background" args={['#150f0a']} />
      <fog attach="fog" args={['#150f0a', 7, 19]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#fff3e2', '#160f08', 0.5]} />
      <directionalLight position={[5, 9, 6]} intensity={1.25} color="#fff3e2" />
      <pointLight position={[-7, 3, 5]} intensity={40} distance={22} color="#ff7a3a" />
      <pointLight position={[7, 4, 5]} intensity={22} distance={22} color="#ffd9a0" />
      <group position={[0, -0.5, 0]}>
        <Frames frames={frames} focusedId={focusedId} onFocus={onFocus} />
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[60, 60]} />
          <MeshReflectorMaterial
            mirror={0.45}
            blur={[300, 100]}
            resolution={1536}
            mixBlur={1}
            mixStrength={55}
            roughness={1}
            depthScale={1.2}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.4}
            color="#0a0603"
            metalness={0.5}
          />
        </mesh>
      </group>
    </Canvas>
  )
}

function Frames({
  frames,
  focusedId,
  onFocus,
  q = new THREE.Quaternion(),
  p = new THREE.Vector3(),
}: {
  frames: FrameData[]
  focusedId: string | null
  onFocus: (id: string | null) => void
  q?: THREE.Quaternion
  p?: THREE.Vector3
}) {
  const ref = useRef<THREE.Group>(null)
  const clicked = useRef<THREE.Object3D | null>(null)

  useEffect(() => {
    if (!ref.current) return
    clicked.current = focusedId ? ref.current.getObjectByName(focusedId) ?? null : null
    if (clicked.current && clicked.current.parent) {
      clicked.current.parent.updateWorldMatrix(true, true)
      clicked.current.parent.localToWorld(p.set(0, GR / 2, 1.25))
      clicked.current.parent.getWorldQuaternion(q)
    } else {
      p.set(0, 0, 5.5)
      q.identity()
    }
  })

  useFrame((state, dt) => {
    easing.damp3(state.camera.position, p, 0.4, dt)
    easing.dampQ(state.camera.quaternion, q, 0.4, dt)
  })

  return (
    <group
      ref={ref}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation()
        onFocus(clicked.current === e.object ? null : e.object.name)
      }}
      onPointerMissed={() => onFocus(null)}
    >
      {frames.map((f) => (
        <Frame key={f.id} data={f} focusedId={focusedId} />
      ))}
    </group>
  )
}

function Frame({ data, focusedId }: { data: FrameData; focusedId: string | null }) {
  const image = useRef<any>(null)
  const frameRef = useRef<any>(null)
  const [hovered, hover] = useState(false)
  const [rnd] = useState(() => Math.random())
  const isActive = focusedId === data.id
  useCursor(hovered)

  useFrame((state, dt) => {
    if (image.current) {
      image.current.material.zoom = 2 + Math.sin(rnd * 10000 + state.clock.elapsedTime / 3) / 2
      easing.damp3(
        image.current.scale,
        [0.85 * (!isActive && hovered ? 0.85 : 1), 0.9 * (!isActive && hovered ? 0.905 : 1), 1],
        0.1,
        dt,
      )
    }
    if (frameRef.current) easing.dampC(frameRef.current.material.color, hovered ? '#ff7a3a' : 'white', 0.1, dt)
  })

  return (
    <group position={data.position} rotation={data.rotation}>
      <mesh
        name={data.id}
        onPointerOver={(e) => { e.stopPropagation(); hover(true) }}
        onPointerOut={() => hover(false)}
        scale={[1, GR, 0.05]}
        position={[0, GR / 2, 0]}
      >
        <boxGeometry />
        <meshStandardMaterial color="#191512" metalness={0.5} roughness={0.5} envMapIntensity={2} />
        <mesh ref={frameRef} raycast={() => null} scale={[0.9, 0.93, 0.9]} position={[0, 0, 0.2]}>
          <boxGeometry />
          <meshBasicMaterial toneMapped={false} fog={false} />
        </mesh>
        {data.url && <Image raycast={() => null} ref={image} position={[0, 0, 0.7]} url={data.url} />}
      </mesh>
    </group>
  )
}
