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

async function getProductId(uid, productCode, productName, attributeValues = []) {
    return new Promise((resolve, reject) => {
        const domain = [['default_code', '=', productCode]];

        if (productName) {
            domain.push(['name', '=', productName]);
        }

        if (attributeValues.length > 0) {
            attributeValues.forEach(value => {
                domain.push(['product_template_attribute_value_ids.name', '=', value]);
            });
        }

        object.methodCall(
            'execute_kw',
            [
                ODOO_BD,
                uid,
                ODOO_PASSWORD,
                'product.product',
                'search_read',
                [domain],
                { fields: ['id', 'product_template_attribute_value_ids'], limit: 1 },
            ],
            (error, result) => {
                if (error) {
                    console.error(`Error al buscar el producto: ${error.message}`);
                    reject(error);
                } else if (result.length === 0) {
                    console.log(`Producto no encontrado para: Código: ${productCode}, Nombre: ${productName}, Atributos: ${attributeValues}`);
                    resolve(null);
                } else {
                    console.log(`Producto encontrado: ${result[0].id}`);
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
                const productCodeMatch = data.product_id.match(/\[(.*?)\]/);
                const productCode = productCodeMatch ? productCodeMatch[1] : null;

                const attributesMatch = data.product_id.match(/\((.*?)\)$/);
                const attributeValues = attributesMatch ? attributesMatch[1].split(',').map(v => v.trim()) : [];

                const productName = data.product_id
                    .replace(/^\[.*?\]\s*/, '')
                    .replace(/\s*\(.*?\)$/, '');

                if (!productCode) {
                    console.error(`Producto inválido: ${data.product_id}`);
                    report.notFound.push({ product: data.product_id, reason: 'Código inválido' });
                    continue;
                }

                const productId = await getProductId(uid, productCode, productName, attributeValues);

                if (!productId) {
                    report.notFound.push({ product: data.product_id, reason: 'Producto no encontrado' });
                    continue;
                }

                const locationId = await getLocationId(uid, data.location_id);
                if (!locationId) {
                    report.notFound.push({ product: data.product_id, reason: 'Ubicación no encontrada' });
                    continue;
                }

                await createStockQuant(uid, locationId, productId, data.quantity);
                report.success.push({
                    product: data.product_id,
                    location: data.location_id,
                    quantity: data.quantity,
                });
            } catch (error) {
                console.error(`Error al procesar el registro ${index + 1}: ${error.message}`);
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
