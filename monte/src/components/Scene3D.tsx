import * as THREE from 'three'
import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useCursor, MeshReflectorMaterial, Image, Text, Environment } from '@react-three/drei'
import { easing } from 'maath'

// Base: demo MIT pmndrs/examples "image-gallery" — mantido fiel, so as fotos viram pratos.
const GOLDENRATIO = 1.61803398875

export interface GalleryImage {
  id: string
  name: string
  url: string
  position: [number, number, number]
  rotation: [number, number, number]
}

export function App({ images }: { images: GalleryImage[] }) {
  return (
    <Canvas dpr={[1, 1.5]} camera={{ fov: 70, position: [0, 2, 15] }}>
      <color attach="background" args={['#191920']} />
      <fog attach="fog" args={['#191920', 0, 15]} />
      <group position={[0, -0.5, 0]}>
        <Frames images={images} />
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[50, 50]} />
          <MeshReflectorMaterial
            mirror={0}
            blur={[300, 100]}
            resolution={2048}
            mixBlur={1}
            mixStrength={80}
            roughness={1}
            depthScale={1.2}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.4}
            color="#050505"
            metalness={0.5}
          />
        </mesh>
      </group>
      <Environment preset="city" />
    </Canvas>
  )
}

function Frames({
  images,
  q = new THREE.Quaternion(),
  p = new THREE.Vector3(),
}: {
  images: GalleryImage[]
  q?: THREE.Quaternion
  p?: THREE.Vector3
}) {
  const ref = useRef<THREE.Group>(null)
  const clicked = useRef<THREE.Object3D | null>(null)
  const [focused, setFocused] = useState<string | null>(null)

  useEffect(() => {
    if (!ref.current) return
    clicked.current = focused ? ref.current.getObjectByName(focused) ?? null : null
    if (clicked.current && clicked.current.parent) {
      clicked.current.parent.updateWorldMatrix(true, true)
      clicked.current.parent.localToWorld(p.set(0, GOLDENRATIO / 2, 1.25))
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
      onClick={(e) => {
        e.stopPropagation()
        setFocused(clicked.current === e.object ? null : e.object.name)
      }}
      onPointerMissed={() => setFocused(null)}
    >
      {images.map((img) => (
        <Frame key={img.id} img={img} focused={focused} />
      ))}
    </group>
  )
}

function Frame({ img, focused }: { img: GalleryImage; focused: string | null }) {
  const image = useRef<any>(null)
  const frame = useRef<any>(null)
  const [hovered, hover] = useState(false)
  const [rnd] = useState(() => Math.random())
  const isActive = focused === img.id
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
    if (frame.current) easing.dampC(frame.current.material.color, hovered ? 'orange' : 'white', 0.1, dt)
  })
  return (
    <group position={img.position} rotation={img.rotation}>
      <mesh
        name={img.id}
        onPointerOver={(e) => { e.stopPropagation(); hover(true) }}
        onPointerOut={() => hover(false)}
        scale={[1, GOLDENRATIO, 0.05]}
        position={[0, GOLDENRATIO / 2, 0]}
      >
        <boxGeometry />
        <meshStandardMaterial color="#151515" metalness={0.5} roughness={0.5} envMapIntensity={2} />
        <mesh ref={frame} raycast={() => null} scale={[0.9, 0.93, 0.9]} position={[0, 0, 0.2]}>
          <boxGeometry />
          <meshBasicMaterial toneMapped={false} fog={false} />
        </mesh>
        <Image raycast={() => null} ref={image} position={[0, 0, 0.7]} url={img.url} />
      </mesh>
      <Text maxWidth={0.1} anchorX="left" anchorY="top" position={[0.55, GOLDENRATIO, 0]} fontSize={0.025}>
        {img.name}
      </Text>
    </group>
  )
}
