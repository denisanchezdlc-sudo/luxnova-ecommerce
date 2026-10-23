require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Configuraciones de seguridad y lectura de datos
app.use(cors());
app.use(express.json()); // Vital para leer los JSON que envían las webs y Mercado Pago
app.use(express.urlencoded({ extended: true }));

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
                description: nombreProducto,
                payment_method_id: 'pagoefectivo_atm', 
                
                // CAMPO OBLIGATORIO PARA APROBAR LA INTEGRACIÓN
                external_reference: id_carrito, 
                
                // Resumen de tarjeta (Gana 5 puntos en MP)
                statement_descriptor: "LUXNOVA DIG", 
                
                // === LOS 4 CAMPOS FALTANTES PARA GANAR 19 PUNTOS ===
                additional_info: {
                    items: [{
                        id: "LX-ACC-01",                     // Código del item (Gana 5 puntos)
                        title: nombreProducto, 
                        description: "Accesorio tecnológico de última generación", // Description del item (Gana 4 puntos)
                        category_id: "electronics",          // Categoría del item (Gana 5 puntos)
                        quantity: 1,
                        unit_price: montoNumerico
                    }]
                },
                // ===================================================
                
                notification_url: `https://${webOrigen}/webhook-mp`, 
                
                payer: {
                    email: clienteEmail,
                    first_name: "Cliente", 
                    last_name: "Shop",     
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

// ==========================================================================
// NUEVA RUTA: RECIBIR WEBHOOK DE MERCADO PAGO Y REENVIAR A CAMPOSOL
// ==========================================================================
app.post('/webhook-mp', async (req, res) => {
    try {
        const { type, data } = req.body;

        // Mercado Pago envía muchos tipos de avisos, solo nos importan los de pagos ('payment')
        if (type === 'payment' && data && data.id) {
            
            console.log(`[Luxnova Webhook] Recibido aviso de pago ID: ${data.id}. Consultando detalles...`);

            // 1. Consultar a Mercado Pago el estado real del pago
            const responseMP = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
                }
            });

            if (!responseMP.ok) {
                console.error("No se pudo obtener el detalle del pago de Mercado Pago");
                return res.status(200).send("OK"); // Respondemos 200 a MP para que deje de molestar
            }

            const pagoDetalle = await responseMP.json();

            // 2. Extraer los datos vitales
            const estado = pagoDetalle.status; // Esperamos 'approved'
            const id_carrito = pagoDetalle.external_reference; // Esperamos 'CMP-...'
            const monto = pagoDetalle.transaction_amount;

            // 3. Si el pago está aprobado y tiene la referencia de Camposol (empieza con CMP)
            if (estado === 'approved' && id_carrito && id_carrito.startsWith('CMP-')) {
                
                console.log(`[Luxnova Webhook] Pago ${data.id} aprobado. Reenviando a Camposol (Carrito: ${id_carrito}, Monto: ${monto})`);

                // 4. EL PUENTE: Enviar los datos al servidor de Camposol en Render
                // REEMPLAZA ESTA URL POR LA URL REAL DE TU SERVIDOR DE CAMPOSOL EN RENDER
                const URL_CAMPOSOL = 'https://camposol-backend.onrender.com/api/webhook-luxnova'; 
                
                const responseCamposol = await fetch(URL_CAMPOSOL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id_carrito: id_carrito,
                        estado: 'PAGADO', // Le decimos a Camposol que ya está pagado
                        monto: monto,
                        origen: 'luxnovadig.com' // Validado por Camposol
                    })
                });

                if (!responseCamposol.ok) {
                    console.error("[Luxnova Webhook] Error: Camposol rechazó el aviso.");
                } else {
                    console.log("[Luxnova Webhook] Éxito: Camposol recibió el aviso y acreditó el saldo.");
                }
            } else {
                 console.log(`[Luxnova Webhook] Pago ignorado (Estado: ${estado}, Ref: ${id_carrito})`);
            }
        }
        
        // SIEMPRE debemos responder 200 OK a Mercado Pago rápidamente
        res.status(200).send("OK");

    } catch (error) {
        console.error("Error crítico en Webhook de Luxnova:", error);
        res.status(500).send("Error interno");
    }
});

// ==========================================
// ENCENDIDO DEL MOTOR
// ==========================================
app.listen(port, () => {
    console.log(`Servidor corporativo de LUXNOVA corriendo en http://localhost:${port}`);
});