import type { Operador } from './tiposTurno'
export function buscarOperadorEmpleado(operadores: readonly Operador[], numero: string): Operador {
 const clave = numero.trim().toUpperCase()
 if (!clave) throw new Error('Escribe tu número de empleado.')
 const filas = operadores.filter(o => o.numero_empleado?.trim().toUpperCase() === clave)
 if (!filas.length) throw new Error('No se encontró ese número de empleado. Solicita su registro a Administración.')
 if (filas.length !== 1) throw new Error('Hay varios operadores con ese número. Solicita su corrección a Administración.')
 if (!filas[0].activo) throw new Error('Ese operador está inactivo. Consulta a Administración.')
 return filas[0]
}
