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
        
        // El servidor tomará 'producto-lux' que le envía la web, 
        // o lo pondrá por defecto si la compra es de Vértice y no trae nombre.
        const nombreProducto = producto || "producto-lux";

        console.log(`[Pago] Iniciando solicitud desde: ${webOrigen} por un monto de S/ ${monto} con el item: ${nombreProducto}`);

        // Llamada directa y segura a la API de Mercado Pago
        const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`, 
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                items: [
                    {
                        title: nombreProducto, // Se envía 'producto-lux' de forma universal
                        quantity: 1,
                        unit_price: parseFloat(monto),
                        currency_id: 'PEN' 
                    }
                ],
                payer: {
                    email: clienteEmail 
                },
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

// NUEVO: Procesamiento API Directo para Yape y PagoEfectivo (Sin salir de la web)
app.post('/generar-pago-directo', async (req, res) => {
    try {
        const { monto, clienteEmail, origen, id_carrito, producto, metodoPago } = req.body;
        
        // 1. Extraemos y desciframos el Token de Lux Network
        const authHeader = req.headers['authorization'];
        let idDelComprador = "ANONIMO";
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                idDelComprador = decoded.id; 
            } catch (err) {
                console.log("Token no válido o ausente.");
            }
        }

        // VALIDACIÓN ESTRICTA: Si falta algún dato, detenemos el proceso antes de hablar con MP
        if (!monto || !clienteEmail || !metodoPago) {
            console.error("Faltan parámetros en el body:", req.body);
            return res.status(400).json({ error: "Faltan parámetros requeridos" });
        }

        const webOrigen = origen || 'luxnovadig.com';
        const nombreProducto = producto || "producto-lux";
        const montoNumerico = parseFloat(monto);

        // 🚨 EL TRUCO NINJA: Si elige Yape, forzamos PagoEfectivo para obtener su QR
        const metodoReal = metodoPago === 'yape' ? 'pagoefectivo_atm' : metodoPago;

        console.log(`[API Directa] Generando ${metodoReal} por S/ ${montoNumerico}`);

        // 2. Llamada directa a v1/payments
        const response = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`, 
                'Content-Type': 'application/json',
                'X-Idempotency-Key': id_carrito 
            },
            body: JSON.stringify({
                transaction_amount: montoNumerico,
                description: nombreProducto,
                payment_method_id: metodoReal, // Usamos la variable interceptada
                notification_url: "https://luxnovadig.com/webhook-tumipay", 
                payer: {
                    email: clienteEmail,
                    first_name: "Cliente", 
                    last_name: "Anonimo",
                    identification: { type: "DNI", number: "70000000" }
                },
                metadata: {
                    origen_web: webOrigen,
                    id_carrito: id_carrito,
                    usuario_id_lux: idDelComprador 
                }
            })
        });

        const data = await response.json();

        if (response.ok && (data.status === 'pending' || data.status === 'approved')) {
            // Devolvemos el Ticket URL en ambos casos
            return res.json({
                exito: true,
                id_pago: data.id,
                metodo: metodoPago, // Le devolvemos 'yape' para que el frontend sepa qué título poner
                ticket_url: data.transaction_details.external_resource_url
            });
        } else {
            console.error("Error devuelto por Mercado Pago:", data);
            return res.status(400).json({ error: "Mercado Pago rechazó los datos", detalle: data });
        }

    } catch (error) {
        console.error("Error crítico en API Directa:", error);
        return res.status(500).json({ error: "No se pudo procesar la solicitud interna" });
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