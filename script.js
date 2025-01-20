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

async function autenticarEnOdoo() {
    try {
        const uid = await new Promise((resolve, reject) => {
            common.methodCall(
                'authenticate',
                [ODOO_BD, ODOO_USERNAME, ODOO_PASSWORD, {}],
                (error, uid) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(uid);
                    }
                }
            );
        });
        return uid;
    } catch (error) {
        console.error('Error al autenticar en Odoo:', error);
        throw error;
    }
}

async function getProductIdByCode(uid, productCode) {
    return new Promise((resolve, reject) => {
        object.methodCall(
            'execute_kw',
            [
                ODOO_BD,
                uid,
                ODOO_PASSWORD,
                'product.product',
                'search_read',
                [[['default_code', '=', productCode]]],
                { fields: ['id'], limit: 1 },
            ],
            (error, result) => {
                if (error) {
                    console.error(`Error al buscar el producto '${productCode}':`, error);
                    reject(error);
                } else if (result.length === 0) {
                    console.error(`Producto con código '${productCode}' no encontrado.`);
                    reject(new Error(`Producto con código '${productCode}' no encontrado.`));
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
            inventory_quantity: quantity,
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
                    console.error('Error al crear el registro en stock.quant:', error);
                    reject(error);
                } else {
                    console.log('Registro creado en stock.quant:', result);
                    resolve(result);
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
                    console.error(`Error al buscar la ubicación '${locationName}':`, error);
                    reject(error);
                } else if (result.length === 0) {
                    console.error(`Ubicación '${locationName}' no encontrada.`);
                    reject(new Error(`Ubicación '${locationName}' no encontrada.`));
                } else {
                    resolve(result[0].id);
                }
            }
        );
    });
}

async function procesarStock(uid) {
    try {
        const stockData = JSON.parse(fs.readFileSync('stock_data.json', 'utf8'));

        for (const data of stockData) {
            try {
                const productCode = data.product_id.match(/^\[(.*?)\]/)[1];
                const productId = await getProductIdByCode(uid, productCode);

                const locationId = await getLocationId(uid, data.location_id);

                await createStockQuant(uid, locationId, productId, data.quantity);
            } catch (error) {
                console.error('Error al procesar stock:', error);
            }
        }
    } catch (error) {
        console.error('Error al leer el archivo JSON:', error);
    }
}

(async () => {
    try {
        const uid = await autenticarEnOdoo();
        if (!uid) {
            console.error('No se pudo autenticar en Odoo.');
            return;
        }

        await procesarStock(uid);
        console.log('Procesamiento de stock completado.');
    } catch (error) {
        console.error('Error durante la ejecución:', error);
    }
})();
