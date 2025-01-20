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
        // console.log('Autenticación exitosa en Odoo. UID:', uid);
        return uid;
    } catch (error) {
        console.error('Error al autenticar en Odoo:', error);
        throw error;
    }
}

async function fetchDatosOdoo(uid, model, domain, fields) {
    return new Promise((resolve, reject) => {
        object.methodCall(
            'execute_kw',
            [ODOO_BD, uid, ODOO_PASSWORD, model, 'search_read', [domain], { fields }],
            (error, result) => {
                if (error) {
                    console.error(`Error al consultar el modelo ${model}:`, error);
                    reject(error);
                } else {
                    console.log(`Datos obtenidos del modelo ${model}:`, JSON.stringify(result, null, 2));
                    resolve(result);
                }
            }
        );
    });
}

async function obtenerDatos(uid) {
    const product_template = await fetchDatosOdoo(uid, 'product.template', [['type', '=', 'product']], ['id', 'name', 'categ_id', 'default_code', 'list_price', 'barcode']);

    const idsProductTemplate = product_template.map(producto => producto.id);

    const product_product = await fetchDatosOdoo(uid, 'product.product', [['product_tmpl_id', 'in', idsProductTemplate]], ['id', 'name', 'default_code', 'lst_price', 'barcode', 'product_tmpl_id']);

    const attribute_lines = await fetchDatosOdoo(uid, 'product.template.attribute.line', [['product_tmpl_id', 'in', idsProductTemplate]], ['id', 'product_tmpl_id', 'attribute_id', 'value_ids']);

    const value_ids = attribute_lines.flatMap(line => line.value_ids);
    const attribute_values = await fetchDatosOdoo(uid, 'product.attribute.value', [['id', 'in', value_ids]], ['id', 'name', 'attribute_id']);

    const datosCombinados = product_template.map(producto => {
        const variantesProducto = product_product.filter(vari => vari.product_tmpl_id[0] === producto.id);
        const atributosProducto = attribute_lines
            .filter(line => line.product_tmpl_id[0] === producto.id)
            .map(line => ({
                attribute_id: line.attribute_id[1],
                values: line.value_ids.map(valueId => {
                    const value = attribute_values.find(val => val.id === valueId);
                    return value ? { id: value.id, name: value.name } : null;
                }).filter(val => val !== null),
            }));

        return {
            ...producto,
            product_product: variantesProducto.map(vari => ({
                id: vari.id,
                name: vari.name,
                default_code: vari.default_code,
                lst_price: vari.lst_price,
                barcode: vari.barcode,
            })),
            product_template_attribute_line: atributosProducto,
        };
    });

    return datosCombinados;
}

(async () => {
    try {
        const uid = await autenticarEnOdoo();
        if (!uid) {
            console.error('No se pudo autenticar en Odoo.');
            return;
        }

        const datosCombinados = await obtenerDatos(uid);

        const outputFile = 'datos_odoo.json';
        fs.writeFileSync(outputFile, JSON.stringify(datosCombinados, null, 2), 'utf8');
        console.log('Datos guardados en', outputFile);
    } catch (error) {
        console.error('Error durante la ejecución:', error);
    }
})();