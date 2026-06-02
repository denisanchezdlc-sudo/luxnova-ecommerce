require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Configuraciones de seguridad y lectura de datos
app.use(cors());
app.use(express.json()); // Vital para que Tumipay nos pueda enviar información

// 1. Mostrar la Vitrina Corporativa al público
app.use(express.static('public'));

// 2. Ruta de Diagnóstico (Actualizada para Auditoría)
app.get('/status', (req, res) => {
    res.json({ 
        empresa: "LUXNOVA DIGITAL S.A.C.",
        estado: "Operativo",
        pasarela: "Esperando credenciales de Tumipay"
    });
});

// ==========================================
// ZONA DE PASARELA DE PAGOS (FUTURA CONEXIÓN)
// ==========================================

// 3. Ruta para generar el link de pago cuando el cliente haga clic en "Comprar"
app.post('/procesar-pago', async (req, res) => {
    const { producto, precio } = req.body;
    
    // Aquí programaremos la llamada a Tumipay usando tus credenciales del .env
    // Tumipay nos devolverá un link seguro y nosotros se lo daremos al cliente.
    
    console.log(`Iniciando compra corporativa de: ${producto} por S/ ${precio} PEN`);
    res.json({ 
        mensaje: "Simulación: Conectando con el entorno seguro...",
        checkout_url: "https://link-de-pago-simulado.com"
    });
});

// 4. Webhook: El teléfono por donde Tumipay nos avisará que el cliente ya pagó
app.post('/webhook-tumipay', (req, res) => {
    const notificacion = req.body;
    
    // Aquí leeremos si el pago fue exitoso para activar el servicio B2B
    console.log("¡Tumipay informa un cambio de estado en una transacción!", notificacion);
    
    res.status(200).send("Notificación recibida exitosamente");
});

// ==========================================
// ENCENDIDO DEL MOTOR
// ==========================================
app.listen(port, () => {
    console.log(`Servidor corporativo de LUXNOVA corriendo en http://localhost:${port}`);
});