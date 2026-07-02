import { Suspense, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { Image, RoundedBox, ContactShadows, Html } from '@react-three/drei'
import * as THREE from 'three'
import { fmtBRL } from '../store/cart'
import type { Prato } from '../lib/types'

function useWood() {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 512
    const ctx = c.getContext('2d')!
    const g = ctx.createLinearGradient(0, 0, 512, 512)
    g.addColorStop(0, '#ab8153'); g.addColorStop(0.5, '#946b40'); g.addColorStop(1, '#7c5732')
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512)
    for (let i = 0; i < 80; i++) {
      const s = 55 + Math.random() * 55
      ctx.strokeStyle = `rgba(${s}, ${s * 0.66}, ${s * 0.4}, ${0.08 + Math.random() * 0.14})`
      ctx.lineWidth = 1 + Math.random() * 2.2
      ctx.beginPath(); const y = Math.random() * 512; ctx.moveTo(0, y)
      for (let x = 0; x <= 512; x += 12) ctx.lineTo(x, y + Math.sin((x + i * 27) * 0.018) * 6 + (Math.random() - 0.5) * 2.4)
      ctx.stroke()
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4
    return t
  }, [])
}

// Tábua 3D com os pratos do pedido em cima
function Board({ cart }: { cart: Prato[] }) {
  const wood = useWood()
  return (
    <group position={[0, 0.1, -2.7]} rotation={[0, 0.3, 0]}>
      <mesh receiveShadow castShadow>
        <cylinderGeometry args={[2.7, 2.78, 0.22, 96]} />
        <meshStandardMaterial map={wood} color="#ffffff" roughness={0.66} metalness={0.03} />
      </mesh>
      <mesh position={[0, 0.111, 0]} receiveShadow>
        <cylinderGeometry args={[2.35, 2.35, 0.02, 96]} />
        <meshStandardMaterial map={wood} color="#e7d4bd" roughness={0.72} />
      </mesh>
      {cart.slice(0, 6).map((d, i, arr) => {
        const ang = (i - (arr.length - 1) / 2) * 0.62
        return (
          <group key={d.id} position={[Math.sin(ang) * 1.5, 0.13, Math.cos(ang) * 0.7 - 0.2]} rotation={[0, -0.3, 0]}>
            {d.foto && <Image url={d.foto} transparent position={[0, 0.6, 0]} scale={[1.05, 1.05] as any} />}
          </group>
        )
      })}
    </group>
  )
}

// Card 3D de um prato do menu (kraft + foto + nome + preço), apoiado no chão
function MenuCard({ prato, position, onAdd }: { prato: Prato; position: [number, number, number]; onAdd: () => void }) {
  const ref = useRef<THREE.Group>(null)
  const [hover, setHover] = useState(false)
  useFrame(() => {
    if (!ref.current) return
    const t = hover ? 1.07 : 1
    ref.current.scale.x += (t - ref.current.scale.x) * 0.16
    ref.current.scale.y = ref.current.scale.z = ref.current.scale.x
  })
  return (
    <group
      ref={ref}
      position={position}
      rotation={[-0.07, 0, 0]}
      onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onAdd() }}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { setHover(false); document.body.style.cursor = 'auto' }}
    >
      <RoundedBox args={[1.26, 1.66, 0.07]} radius={0.08} smoothness={4} position={[0, 0.83, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#e9d7b6" roughness={0.92} />
      </RoundedBox>
      {prato.foto && <Image url={prato.foto} transparent position={[0, 1.04, 0.045]} scale={[1.1, 1.1] as any} />}
      <Html position={[0, 0.26, 0.06]} center distanceFactor={7} pointerEvents="none">
        <div className="c3d-cap">
          <b>{prato.nome}</b>
          <span>{fmtBRL(prato.preco)}</span>
        </div>
      </Html>
    </group>
  )
}

function MenuRow({ pratos, onAdd }: { pratos: Prato[]; onAdd: (p: Prato) => void }) {
  const group = useRef<THREE.Group>(null)
  const scroll = useRef(0)
  const target = useRef(0)
  const dragging = useRef(false)
  const lastX = useRef(0)
  const gap = 1.55
  const total = (pratos.length - 1) * gap
  const limit = Math.max(0, (total - 4.6) / 2) // quanto dá pra rolar pra cada lado

  useFrame(() => {
    scroll.current += (target.current - scroll.current) * 0.15
    if (group.current) group.current.position.x = scroll.current
  })

  return (
    <group position={[0, 0, 2.0]}>
      {/* plano invisível pra capturar arraste/scroll lateral */}
      <mesh
        position={[0, 1, -0.7]}
        onPointerDown={(e) => { dragging.current = true; lastX.current = e.point.x }}
        onPointerUp={() => { dragging.current = false }}
        onPointerLeave={() => { dragging.current = false }}
        onPointerMove={(e) => {
          if (!dragging.current || limit === 0) return
          target.current = THREE.MathUtils.clamp(target.current + (e.point.x - lastX.current), -limit, limit)
          lastX.current = e.point.x
        }}
        onWheel={(e) => {
          if (limit === 0) return
          target.current = THREE.MathUtils.clamp(target.current - (e.deltaY + e.deltaX) * 0.0035, -limit, limit)
        }}
      >
        <planeGeometry args={[48, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <group ref={group}>
        {pratos.map((p, i) => (
          <MenuCard key={p.id} prato={p} position={[(i - (pratos.length - 1) / 2) * gap, 0, 0]} onAdd={() => onAdd(p)} />
        ))}
      </group>
    </group>
  )
}

export function Scene3D({ pratos, cart, onAdd }: { pratos: Prato[]; cart: Prato[]; onAdd: (p: Prato) => void }) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 4.4, 8], fov: 35 }}
      gl={{ antialias: true, alpha: true }}
      style={{ width: '100%', height: '100%' }}
    >
      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#fff3e2', '#241810', 0.5]} />
      <directionalLight position={[5, 10, 6]} intensity={1.5} color="#fff3e2" castShadow shadow-mapSize={[2048, 2048]}>
        <orthographicCamera attach="shadow-camera" args={[-14, 14, 14, -14, 0.1, 44]} />
      </directionalLight>
      <Suspense fallback={null}>
        <Board cart={cart} />
        <MenuRow pratos={pratos} onAdd={onAdd} />
      </Suspense>
      <ContactShadows position={[0, 0, 0]} opacity={0.55} scale={30} blur={2.6} far={8} resolution={1024} color="#000000" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[70, 70]} />
        <meshStandardMaterial color="#160f08" roughness={1} />
      </mesh>
    </Canvas>
  )
}
