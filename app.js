require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Configuraciones de seguridad y lectura de datos
app.use(cors());
app.use(express.json()); // Vital para leer los JSON que envían las webs y Mercado Pago

// 1. Mostrar la Vitrina Corporativa al público
app.use(express.static('public'));

// 2. Ruta de Diagnóstico (Actualizada para Auditoría con Mercado Pago)
app.get('/status', (req, res) => {
    res.json({ 
        empresa: "LUXNOVA DIGITAL S.A.C.",
        estado: "Operativo",
        pasarela: "Mercado Pago Checkout Pro (Centralizado)"
    });
});

// Ruta para recibir al cliente tras un pago exitoso
app.get('/pago-exitoso', (req, res) => {
    res.sendFile(__dirname + '/public/pago-exitoso.html');
});

// Ruta para recibir al cliente tras un pago exitoso
app.get('/pago-exitoso', (req, res) => {
    res.sendFile(__dirname + '/public/pago-exitoso.html');
});

// NUEVO: Ruta si el pago falla o el cliente le da a "Volver a la tienda"
app.get('/pago-fallido', (req, res) => {
    res.sendFile(__dirname + '/public/pago-fallido.html');
});

// NUEVO: Ruta si el pago queda pendiente (ej: Pago en efectivo)
app.get('/pago-pendiente', (req, res) => {
    res.send("<h2 style='text-align:center; font-family:sans-serif; margin-top:50px;'>Tu pago está pendiente. Te enviaremos un correo cuando se confirme.</h2>");
});

// ==========================================================================
// ZONA DE PASARELA DE PAGOS (MERCADO PAGO CENTRALIZADO)
// ==========================================================================

const jwt = require('jsonwebtoken'); // Asegúrate de tener esto arriba en tu app.js

app.post('/procesar-pago', async (req, res) => {
    try {
        const { monto, clienteEmail, origen, id_carrito, producto } = req.body;
        
        // 1. Extraemos y desciframos el Token que nos envió Lux Network
        const authHeader = req.headers['authorization'];
        let idDelComprador = "ANONIMO";
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                idDelComprador = decoded.id; // ¡AQUÍ ATRAPAMOS SU ID REAL!
            } catch (err) {
                console.log("Token no válido o ausente, se procesa como anónimo.");
            }
        }

        // Validaciones de seguridad básicas
        if (!monto || !clienteEmail) {
            return res.status(400).json({ error: "Faltan parámetros requeridos (monto o clienteEmail)" });
        }

        // Si no se envía un origen explícito, asumimos que viene de la web local
        const webOrigen = origen || 'luxnovadig.com';
        // Tomamos el producto real que envía el frontend para variar el concepto de compra
        const nombreProducto = producto || "Compra en Plataforma Luxnova";

        console.log(`[Pago] Iniciando solicitud desde: ${webOrigen} por un monto de S/ ${monto}`);

        // Llamada directa y segura a la API de Mercado Pago Checkout Pro
        const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`, 
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                items: [
                    {
                        title: nombreProducto, // ¡ADIÓS OKCASH! Ahora dirá "Recarga de Saldo..."
                        quantity: 1,
                        unit_price: parseFloat(monto),
                        currency_id: 'PEN' 
                    }
                ],
                payer: {
                    email: clienteEmail // Recibe el correo dinámico único generado en el frontend
                },
                // LA JUGADA MAESTRA: Guardamos el origen y el ID REAL en la metadata
                metadata: {
                    origen_web: webOrigen,
                    id_carrito: id_carrito || Date.now().toString(),
                    usuario_id_lux: idDelComprador 
                },
                // Redirecciones dinámicas basadas en la web que inició la compra
                back_urls: {
                    success: `https://${webOrigen}/pago-exitoso`,
                    failure: `https://${webOrigen}/pago-fallido`,
                    pending: `https://${webOrigen}/pago-pendiente`
                },
                auto_return: "approved"
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Error al comunicarse con Mercado Pago");
        }

        // Devolvemos la URL real de Mercado Pago para que la interfaz redirija al usuario
        res.json({ 
            mensaje: "Conexión segura establecida con Mercado Pago",
            checkout_url: data.init_point 
        });

    } catch (error) {
        console.error("Error crítico al generar preferencia de pago:", error);
        res.status(500).json({ error: "No se pudo procesar la solicitud de pago seguro" });
    }
});

// PASO 2 REEMPLAZADO: Webhook unificado (Escucha a Mercado Pago y enruta las confirmaciones)
app.post('/webhook-tumipay', async (req, res) => {
    try {
        // Mercado Pago envía notificaciones con estructuras específicas (type y data.id)
        const { type, data } = req.body;

        if (type === 'payment' && data && data.id) {
            const paymentId = data.id;

            console.log(`[Webhook] Notificación recibida para el pago ID: ${paymentId}. Verificando...`);

            // Consultamos los detalles reales del pago en los servidores de Mercado Pago
            const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
            });

            const paymentData = await paymentResponse.json();

            // Si el pago es real y está aprobado de forma definitiva
            if (paymentResponse.ok && paymentData.status === 'approved') {
                
                /// Extraemos la metadata sembrada
                const { origen_web, id_carrito, usuario_id_lux } = paymentData.metadata; // <--- SACAMOS EL ID
                const montoAprobado = paymentData.transaction_amount;
                const emailComprador = paymentData.payer.email;

                console.log(`[Webhook] ¡PAGO APROBADO! S/ ${montoAprobado} de ${emailComprador}`);

                // ENRUTADOR INTELIGENTE SEGÚN EL ORIGEN
                if (origen_web === 'lux-network-core.onrender.com') {
                    console.log(`--> Enrutando despacho automático hacia Lux Network Core...`);
                    
                    // Disparamos una alerta silenciosa al backend de tu segunda web
                    try {
                        await fetch('https://lux-network-core.onrender.com/api/confirmar-pedido', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                id_carrito: id_carrito,
                                estado: 'PAGADO',
                                monto: montoAprobado,
                                usuario_id_real: usuario_id_lux // <--- LE ENVIAMOS EL ID EXACTO A LUX NETWORK
                            })
                        });
                    } catch (err) {
                        console.error("Error al notificar al servidor secundario lux-network-core:", err);
                    }

                } else {
                    // Flujo por defecto para compras locales en Vértice Corporativo
                    console.log(`--> Procesando despacho local para Vértice Corporativo (Guardar en Supabase, emitir comprobante, etc.)`);
                }
            }
        }

        // Siempre respondemos 200 OK a Mercado Pago de inmediato para que no reintente el envío
        res.status(200).send('OK');

    } catch (error) {
        console.error("Error procesando evento del Webhook:", error);
        res.status(200).send('Procesado con observaciones internas');
    }
});

// ==========================================
// ENCENDIDO DEL MOTOR
// ==========================================
app.listen(port, () => {
    console.log(`Servidor corporativo de LUXNOVA corriendo en http://localhost:${port}`);
});