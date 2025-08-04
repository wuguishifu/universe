'use client';

import { OrbitControls } from '@react-three/drei';
import { Canvas, ThreeElements, useFrame } from '@react-three/fiber';
import { Suspense, useRef, useState } from 'react';
import { Mesh } from 'three';

function Box(props: ThreeElements['mesh']) {
  const meshRef = useRef<Mesh>(null);
  const [hovered, setHover] = useState(false);
  const [active, setActive] = useState(false);

  useFrame((state, delta) => {
    if (!meshRef.current) {
      return;
    }

    meshRef.current.rotation.x += delta;
  });

  return (
    <mesh
      {...props}
      ref={meshRef}
      onClick={(event) => setActive(!active)}
      onPointerOver={(event) => setHover(true)}
      onPointerOut={(event) => setHover(false)}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={hovered ? 'hotpink' : 'orange'} />
    </mesh>
  );
}

export default function Index() {
  return (
    <div className="w-full h-screen">
      <Suspense fallback={null}>
        <Canvas className="w-full h-full" camera={{ position: [0, 0, 15] }}>
          <OrbitControls enableDamping dampingFactor={0.05} />
          <ambientLight intensity={Math.PI / 2} />
          <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} decay={0} intensity={Math.PI} />
          <pointLight position={[-10, -10, -10]} decay={0} intensity={Math.PI} />
          <Box position={[0, 0, 0]} scale={[5, 5, 5]} />
        </Canvas>
      </Suspense>
    </div>
  );
}
