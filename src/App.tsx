import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
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
import { Inicio } from './pages/Inicio'

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
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/sin-acceso" element={<SinAcceso />} />

        <Route element={<RutaProtegida />}>
          <Route path="/" element={<Inicio />} />
          <Route element={<RutaProtegida roles={['calderas', 'ptar', 'admin']} />}><Route path="/planta" element={<Inicio vista="planta" />} /></Route>
          <Route element={<RutaProtegida roles={['calidad', 'admin']} />}><Route path="/calidad" element={<Inicio vista="calidad" />} /><Route path="/gestion" element={<Inicio vista="gestion" />} /></Route>

          <Route element={<RutaProtegida roles={['calderas', 'admin']} />}>
            <Route path="/calderas" element={<Inicio vista="calderas" />} />
          </Route>

          <Route element={<RutaProtegida roles={['ptar', 'admin']} />}>
            <Route path="/ptar" element={<Inicio vista="ptar" />} />
          </Route>

          <Route element={<RutaProtegida roles={['admin']} />}>
            <Route path="/reportes" element={<Inicio vista="reportes" />} />
            <Route path="/administracion" element={<Inicio vista="administracion" />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App

