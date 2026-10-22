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
        
        // 1. Extraemos y desciframos el Token que nos envió Lux2
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

// ==========================================================================
// PROCESAMIENTO API DIRECTO PARA PAGOEFECTIVO (FORMATO EXACTO A LA IMAGEN)
// ==========================================================================
app.post('/generar-pago-directo', async (req, res) => {
    try {
        const { monto, clienteEmail, origen, id_carrito, producto } = req.body;
        
        // VALIDACIÓN ESTRICTA
        if (!monto || !clienteEmail) {
            return res.status(400).json({ error: "Faltan parámetros requeridos" });
        }

        const webOrigen = origen || 'luxnovadig.com';
        const nombreProducto = producto || "Producto - Top";
        const montoNumerico = parseFloat(monto);

        console.log(`[API Directa] Generando ticket en Mercado Pago por S/ ${montoNumerico}`);

        // Llamada directa a v1/payments (Genera el ticket de PagoEfectivo al instante)
        const response = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`, 
                'Content-Type': 'application/json',
                'X-Idempotency-Key': id_carrito // Evita pagos duplicados
            },
            body: JSON.stringify({
                transaction_amount: montoNumerico,
                description: nombreProducto, // Aparecerá como "Producto- Top" o lo que hayas puesto
                payment_method_id: 'pagoefectivo_atm', // Fuerza a usar PagoEfectivo
                
                // AÑADIMOS EL CAMPO OBLIGATORIO PARA APROBAR LA INTEGRACIÓN
                external_reference: id_carrito, 
                
                // MUY IMPORTANTE: A esta URL llamará Mercado Pago cuando el cliente pague
                notification_url: `https://${webOrigen}/webhook-mp`, 
                
                payer: {
                    email: clienteEmail,
                    first_name: "Cliente", // <-- EXACTAMENTE COMO TU IMAGEN
                    last_name: "Shop",     // <-- EXACTAMENTE COMO TU IMAGEN
                    identification: { type: "DNI", number: "70000000" }
                },
                metadata: {
                    origen_web: webOrigen, 
                    id_carrito: id_carrito
                }
            })
        });

        const data = await response.json();

        if (response.ok && (data.status === 'pending' || data.status === 'approved')) {
            return res.json({
                exito: true,
                id_pago: data.id,
                // Extraemos la información vital del pago para mandarla cruda al frontend
                cip: data.barcode?.content || data.transaction_details?.payment_method_reference_id || 'PROCESANDO',
                vencimiento: data.date_of_expiration,
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

// ==========================================
// ENCENDIDO DEL MOTOR
// ==========================================
app.listen(port, () => {
    console.log(`Servidor corporativo de LUXNOVA corriendo en http://localhost:${port}`);
});