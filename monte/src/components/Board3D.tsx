import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import * as THREE from 'three'

// Textura de madeira gerada por codigo (canvas) - sem arquivo externo.
function useWoodTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 512
    const ctx = c.getContext('2d')!
    const g = ctx.createLinearGradient(0, 0, 512, 512)
    g.addColorStop(0, '#ab8153')
    g.addColorStop(0.5, '#946b40')
    g.addColorStop(1, '#7c5732')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 512, 512)
    for (let i = 0; i < 80; i++) {
      const s = 55 + Math.random() * 55
      ctx.strokeStyle = `rgba(${s}, ${s * 0.66}, ${s * 0.4}, ${0.08 + Math.random() * 0.14})`
      ctx.lineWidth = 1 + Math.random() * 2.2
      ctx.beginPath()
      const y = Math.random() * 512
      ctx.moveTo(0, y)
      for (let x = 0; x <= 512; x += 12) {
        ctx.lineTo(x, y + Math.sin((x + i * 27) * 0.018) * 6 + (Math.random() - 0.5) * 2.4)
      }
      ctx.stroke()
    }
    const tex = new THREE.CanvasTexture(c)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.anisotropy = 4
    return tex
  }, [])
}

function Board() {
  const wood = useWoodTexture()
  return (
    <group rotation={[0, 0.35, 0]}>
      {/* disco de madeira (leve chanfro: base um tiquinho maior) */}
      <mesh>
        <cylinderGeometry args={[2, 2.06, 0.2, 96]} />
        <meshStandardMaterial map={wood} color="#ffffff" roughness={0.66} metalness={0.03} />
      </mesh>
      {/* rebaixo central sutil (marca de tabua de servir) */}
      <mesh position={[0, 0.101, 0]}>
        <cylinderGeometry args={[1.72, 1.72, 0.02, 96]} />
        <meshStandardMaterial map={wood} color="#e7d4bd" roughness={0.7} metalness={0.02} />
      </mesh>
    </group>
  )
}

export function Board3D() {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 6, 8], fov: 30 }}
      gl={{ antialias: true, alpha: true }}
      style={{ width: '100%', height: '100%' }}
    >
      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#fff3e2', '#241810', 0.5]} />
      <directionalLight position={[4, 7.5, 4]} intensity={1.5} color="#fff3e2" />
      <directionalLight position={[-4.5, 3, -3]} intensity={0.28} color="#ffe6c0" />
      <Board />
      <ContactShadows position={[0, -0.1, 0]} opacity={0.55} scale={9} blur={2.8} far={4.5} resolution={512} color="#000000" />
    </Canvas>
  )
}
