import xmlrpc from 'xmlrpc';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const ODOO_URL = process.env.ODOO_URL;
const ODOO_BD = process.env.ODOO_BD;
const ODOO_USERNAME = process.env.ODOO_USERNAME;
const ODOO_PASSWORD = process.env.ODOO_PASSWORD;

const common = xmlrpc.createClient({
    url: `${ODOO_URL}/xmlrpc/2/common`,
    headers: {
        'Content-Type': 'text/xml',
    },
});

const object = xmlrpc.createClient({
    url: `${ODOO_URL}/xmlrpc/2/object`,
    headers: {
        'Content-Type': 'text/xml',
    },
});

let report = {
    success: [],
    notFound: [],
    errors: []
};

async function autenticarEnOdoo() {
    try {
        const uid = await new Promise((resolve, reject) => {
            common.methodCall(
                'authenticate',
                [ODOO_BD, ODOO_USERNAME, ODOO_PASSWORD, {}],
                (error, uid) => {
                    if (error) {
                        reject(new Error(`Error al autenticar en Odoo: ${error.message}`));
                    } else {
                        resolve(uid);
                    }
                }
            );
        });
        return uid;
    } catch (error) {
        console.error(error.message);
        throw error;
    }
}

async function getProductId(uid, productCode, productName) {
    return new Promise((resolve, reject) => {
        const domain = [];

        if (productCode) {
            domain.push(['default_code', '=', productCode]);
        }

        if (productName) {
            domain.push(['name', '=', productName]);
        }

        console.log(`Buscando producto con dominio: ${JSON.stringify(domain)}`);

        object.methodCall(
            'execute_kw',
            [
                ODOO_BD,
                uid,
                ODOO_PASSWORD,
                'product.product',
                'search_read',
                [domain],
                { fields: ['id', 'default_code', 'name', 'type'], limit: 1 },
            ],
            (error, result) => {
                if (error) {
                    console.error(`Error al buscar el producto: ${error.message}`);
                    reject(error);
                } else if (result.length === 0) {
                    console.log(`Producto no encontrado: Nombre: ${productName}, Código: ${productCode}`);
                    resolve(null);
                } else {
                    const product = result[0];
                    if (product.type === 'consu' || product.type === 'service') {
                        console.log(`Producto no válido para inventario: ${productName} (${product.type})`);
                        resolve({ id: product.id, valid: false });
                    } else {
                        console.log(`Producto encontrado: ${product.id}`);
                        resolve({ id: product.id, valid: true });
                    }
                }
            }
        );
    });
}

async function getVariantValueId(uid, variantValue) {
    return new Promise((resolve, reject) => {
        object.methodCall(
            'execute_kw',
            [
                ODOO_BD,
                uid,
                ODOO_PASSWORD,
                'product.template.attribute.value',
                'search_read',
                [[['name', '=', variantValue]]],
                { fields: ['id'], limit: 1 },
            ],
            (error, result) => {
                if (error) {
                    console.error(`Error al buscar el valor de variante '${variantValue}': ${error.message}`);
                    reject(error);
                } else if (result.length === 0) {
                    console.log(`Valor de variante no encontrado: ${variantValue}`);
                    resolve(null);
                } else {
                    resolve(result[0].id);
                }
            }
        );
    });
}

async function getLocationId(uid, locationName) {
    return new Promise((resolve, reject) => {
        object.methodCall(
            'execute_kw',
            [
                ODOO_BD,
                uid,
                ODOO_PASSWORD,
                'stock.location',
                'search_read',
                [[['complete_name', '=', locationName]]],
                { fields: ['id'], limit: 1 },
            ],
            (error, result) => {
                if (error) {
                    console.error(`Error al buscar la ubicación '${locationName}': ${error.message}`);
                    reject(error);
                } else if (result.length === 0) {
                    resolve(null);
                } else {
                    resolve(result[0].id);
                }
            }
        );
    });
}

async function createStockQuant(uid, locationId, productId, quantity) {
    return new Promise((resolve, reject) => {
        const params = {
            location_id: locationId,
            product_id: productId,
            quantity: quantity,
        };

        object.methodCall(
            'execute_kw',
            [
                ODOO_BD,
                uid,
                ODOO_PASSWORD,
                'stock.quant',
                'create',
                [params],
            ],
            (error, result) => {
                if (error) {
                    console.error(`Error al crear el registro en stock.quant: ${error.message}`);
                    reject(error);
                } else {
                    console.log('Registro creado en stock.quant:', result);
                    resolve(result);
                }
            }
        );
    });
}

async function procesarStock(uid) {
    try {
        const stockData = JSON.parse(fs.readFileSync('stock_data.json', 'utf8'));

        for (let index = 0; index < stockData.length; index++) {
            const data = stockData[index];
            console.log(`Procesando producto ${index + 1} de ${stockData.length}:`, data.product_id);

            try {
                const defaultCodeMatch = data.product_id.match(/\[(.*?)\]/);
                const defaultCode = defaultCodeMatch ? defaultCodeMatch[1].trim() : null;
                const productName = data.product_id.replace(/\[.*?\]/, '').trim();
                const variantMatch = data.product_id.match(/\((.*?)\)$/);
                const variant = variantMatch ? variantMatch[1].trim() : null;

                let product = null;

                if (defaultCode) {
                    console.log(`Buscando por default_code: ${defaultCode}`);
                    product = await getProductId(uid, defaultCode, null);
                }

                if (!product && productName) {
                    console.log(`Buscando por nombre: ${productName}`);
                    product = await getProductId(uid, null, productName);
                }

                if (!product && variant) {
                    console.log(`Buscando ID de variante para: ${variant}`);
                    const variantId = await getVariantValueId(uid, variant);

                    if (variantId) {
                        console.log(`Buscando por variante ID: ${variantId}`);
                        product = await new Promise((resolve, reject) => {
                            object.methodCall(
                                'execute_kw',
                                [
                                    ODOO_BD,
                                    uid,
                                    ODOO_PASSWORD,
                                    'product.product',
                                    'search_read',
                                    [[['product_template_variant_value_ids', 'in', [variantId]]]],
                                    { fields: ['id', 'default_code', 'name', 'type'], limit: 1 },
                                ],
                                (error, result) => {
                                    if (error) {
                                        console.error(`Error al buscar el producto por variante ID: ${error.message}`);
                                        reject(error);
                                    } else if (result.length === 0) {
                                        console.log(`Producto no encontrado para variante ID: ${variantId}`);
                                        resolve(null);
                                    } else {
                                        resolve(result[0]);
                                    }
                                }
                            );
                        });
                    }
                }

                if (!product) {
                    console.error(`Producto no encontrado: ${data.product_id}`);
                    report.notFound.push({ product: data.product_id, reason: 'Producto no encontrado' });
                    continue;
                }

                if (!product.valid) {
                    console.error(`Producto no válido para inventario: ${data.product_id}`);
                    report.notFound.push({ product: data.product_id, reason: 'Producto no válido para inventario' });
                    continue;
                }

                const locationId = await getLocationId(uid, data.location_id);
                if (!locationId) {
                    console.error(`Ubicación no encontrada: ${data.location_id}`);
                    report.notFound.push({ product: data.product_id, reason: 'Ubicación no encontrada' });
                    continue;
                }

                await createStockQuant(uid, locationId, product.id, data.quantity);
                report.success.push({
                    product: data.product_id,
                    location: data.location_id,
                    quantity: data.quantity,
                });
                console.log(`Registro creado para producto: ${data.product_id}`);
            } catch (error) {
                console.error(`Error al procesar el producto ${index + 1} (${data.product_id}): ${error.message}`);
                report.errors.push({ product: data.product_id, error: error.message });
            }
        }
    } catch (error) {
        console.error('Error al leer el archivo JSON:', error.message);
        throw error;
    }
}

function generarReporte() {
    fs.writeFileSync(
        'reporte_stock.json',
        JSON.stringify(report, null, 2),
        'utf8'
    );
    console.log('Reporte generado: reporte_stock.json');
}

(async () => {
    try {
        const uid = await autenticarEnOdoo();
        if (!uid) {
            console.error('No se pudo autenticar en Odoo.');
            return;
        }

        await procesarStock(uid);
        generarReporte();
        console.log('Procesamiento de stock completado.');
    } catch (error) {
        console.error('Error durante la ejecución:', error.message);
    }
})();