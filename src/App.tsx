import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { ControlSesion } from './components/auth/ControlSesion'
import { ControlTurno } from './components/turno/ControlTurno'
import { ControlBitacora } from './components/bitacora/ControlBitacora'
import { ControlPTAR } from './components/ptar/ControlPTAR'
import { ControlCalidad } from './components/calidad/ControlCalidad'
import { ControlUF } from './components/uf/ControlUF'
import { ControlPozos } from './components/pozos/ControlPozos'
import { RutaProtegida } from './components/auth/RutaProtegida'
import { Login } from './pages/Login'
import { SinAcceso } from './pages/SinAcceso'
const Inicio = lazy(() => import('./pages/Inicio').then(m => ({ default: m.Inicio })))

function App() {
  return (
    <BrowserRouter>
      <ControlSesion />
      <ControlTurno />
      <ControlPozos />
      <ControlUF />
      <ControlCalidad />
      <ControlPTAR />
      <ControlBitacora />
      <Suspense fallback={<p role="status">Cargando aplicación…</p>}><Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/sin-acceso" element={<SinAcceso />} />

        <Route element={<RutaProtegida />}>
          <Route path="/" element={<Inicio />} />
          <Route path="/planta" element={<Inicio vista="planta" />} />
          <Route path="/calderas" element={<Inicio vista="calderas" />} />
          <Route path="/ptar" element={<Inicio vista="ptar" />} />
          <Route path="/calidad" element={<Inicio vista="calidad" />} />
          <Route path="/gestion" element={<Inicio vista="gestion" />} />
          <Route path="/calidad/limites" element={<Inicio vista="limites" />} />
          <Route path="/reportes" element={<Inicio vista="reportes" />} />
          <Route path="/administracion" element={<Inicio vista="administracion" />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes></Suspense>
    </BrowserRouter>
  )
}

export default App

