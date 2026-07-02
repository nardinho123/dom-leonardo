import { useMenu } from './hooks/useMenu'
import { App as Gallery, type GalleryImage } from './components/Scene3D'

// Posicoes EXATAS do demo pmndrs/examples "image-gallery" (frente / fundo / esquerda / direita).
const SLOTS: Array<Pick<GalleryImage, 'position' | 'rotation'>> = [
  // Frente
  { position: [0, 0, 1.5], rotation: [0, 0, 0] },
  // Fundo
  { position: [-0.8, 0, -0.6], rotation: [0, 0, 0] },
  { position: [0.8, 0, -0.6], rotation: [0, 0, 0] },
  // Esquerda
  { position: [-1.75, 0, 0.25], rotation: [0, Math.PI / 2.5, 0] },
  { position: [-2.15, 0, 1.5], rotation: [0, Math.PI / 2.5, 0] },
  { position: [-2, 0, 2.75], rotation: [0, Math.PI / 2.5, 0] },
  // Direita
  { position: [1.75, 0, 0.25], rotation: [0, -Math.PI / 2.5, 0] },
  { position: [2.15, 0, 1.5], rotation: [0, -Math.PI / 2.5, 0] },
  { position: [2, 0, 2.75], rotation: [0, -Math.PI / 2.5, 0] },
]

export default function App() {
  const { pratos } = useMenu()

  const images: GalleryImage[] = SLOTS.map((slot, i) => {
    const pr = pratos[i]
    return {
      id: pr ? pr.id : `slot-${i}`,
      name: pr ? pr.nome : '',
      url: pr?.foto ?? '',
      position: slot.position,
      rotation: slot.rotation,
    }
  }).filter((img) => img.url)

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      {images.length > 0 && <Gallery images={images} />}
    </div>
  )
}
