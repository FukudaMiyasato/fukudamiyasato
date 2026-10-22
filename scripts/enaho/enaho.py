#!/usr/bin/env python3
"""
============================================================
 scripts/enaho/enaho.py — ENAHO (INEI) → data/enaho/<año>.json
 ------------------------------------------------------------
 Se corre una vez por año, cuando el INEI publica la ENAHO anual
 (Metodología actualizada) en https://proyectos.inei.gob.pe/microdatos/.
 El widget «ENAHO» del lienzo solo lee el JSON: no consulta al INEI ni
 gasta tokens.

   python3 -m venv .venv && .venv/bin/pip install -r scripts/enaho/requirements.txt
   .venv/bin/python scripts/enaho/enaho.py --anio 2025 --codigo 1031

 --codigo es el número de la encuesta en el portal (2025 → 1031,
 2024 → 966, 2023 → 906): aparece en el link de descarga de cada
 módulo, p. ej. .../descarga/STATA/1031-Modulo34.zip.
 Los .zip se guardan en --crudos (por defecto ~/.cache/enaho) y no se
 vuelven a bajar si ya están.

 Módulos que se cruzan (por conglome, vivienda, hogar y codperso):
   01 hogar (internet y celular en casa) · 02 miembros (sexo, edad,
   residentes) · 03 educación (nivel, uso de internet, para qué, celular
   propio) · 04 salud (seguros) · 05 empleo e ingresos · 34 Sumaria
   (gasto, ingreso, pobreza, tamaño del hogar)

 Indicadores ponderados con los factores de expansión (facpob07; los de
 empleo, fac500a) para cada departamento × área × edad × sexo, con
 «todos» en cada filtro. La ENAHO NO pregunta por redes sociales
 específicas (Facebook, TikTok, WhatsApp…): solo para qué se usa internet.
============================================================
"""

import argparse
import datetime as dt
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
import pyreadstat

BASE_URL = 'https://proyectos.inei.gob.pe/iinei/srienaho/descarga/STATA'
RAIZ = Path(__file__).resolve().parents[2]
KEYS = ['conglome', 'vivienda', 'hogar']

DEPS = {
    '01': 'Amazonas', '02': 'Áncash', '03': 'Apurímac', '04': 'Arequipa', '05': 'Ayacucho',
    '06': 'Cajamarca', '07': 'Callao', '08': 'Cusco', '09': 'Huancavelica', '10': 'Huánuco',
    '11': 'Ica', '12': 'Junín', '13': 'La Libertad', '14': 'Lambayeque', '15': 'Lima',
    '16': 'Loreto', '17': 'Madre de Dios', '18': 'Moquegua', '19': 'Pasco', '20': 'Piura',
    '21': 'Puno', '22': 'San Martín', '23': 'Tacna', '24': 'Tumbes', '25': 'Ucayali',
}
# rangos de edad: «t» son los de 18 años o más
EDADES = [('12-17', 12, 17), ('18-24', 18, 24), ('25-34', 25, 34), ('35-44', 35, 44), ('45-59', 45, 59), ('60+', 60, 200)]
EDU = ['Sin nivel o inicial', 'Primaria', 'Secundaria', 'Superior no universitaria', 'Superior universitaria']
# para qué usó internet (p316_k): las 9, 10 y 11 son «otros»
USOS = [
    (1, 'Obtener información'), (2, 'Comunicarse (correo, chat, llamadas)'), (7, 'Entretenimiento (videos, música, juegos)'),
    (5, 'Educación y capacitación'), (3, 'Comprar productos o servicios'), (4, 'Banca electrónica'),
    (8, 'Vender productos o servicios'), (6, 'Trámites con el Estado'), (12, 'Descargar aplicativos o software'),
]
# orden de los valores de cada cruce en el JSON
CAMPOS = ['n', 'hh', 'pop', 'gpc', 'gh', 'ipc', 'ih', 'il', 'ocu', 'pobre', 'pobext', 'tam', 'sec',
          *[f'edu{i}' for i in range(len(EDU))], 'seguro', 'sis', 'essalud',
          'internet', 'celular', 'intcasa', 'intfija', 'celhog', 'diario', *[f'uso{k}' for k, _ in USOS]]


def bajar(codigo, modulo, crudos):
    """El .zip del módulo (lo baja si no está). Devuelve (ruta, Last-Modified)."""
    url = f'{BASE_URL}/{codigo}-Modulo{modulo}.zip'
    ruta = crudos / f'{codigo}-Modulo{modulo}.zip'
    req = urllib.request.Request(url, method='HEAD')
    with urllib.request.urlopen(req, timeout=60) as r:
        fecha = r.headers.get('Last-Modified')
    if not ruta.exists():
        print(f'  bajando {url}…', file=sys.stderr)
        tmp = ruta.with_suffix('.part')
        urllib.request.urlretrieve(url, tmp)
        tmp.rename(ruta)
    return ruta, fecha


def leer(zip_ruta, prefijo, columnas, crudos):
    """Solo las columnas que hacen falta del .dta cuyo nombre empieza con `prefijo`."""
    with zipfile.ZipFile(zip_ruta) as z:
        # el más corto: sumaria-2025.dta y no sumaria-2025-12g.dta
        nombre = min((n for n in z.namelist() if Path(n).name.lower().startswith(prefijo) and n.lower().endswith('.dta')), key=len)
        destino = crudos / 'dta' / Path(nombre).name
        if not destino.exists():
            destino.parent.mkdir(parents=True, exist_ok=True)
            with z.open(nombre) as src, open(destino, 'wb') as out:
                while chunk := src.read(1 << 20):
                    out.write(chunk)
    _, meta = pyreadstat.read_dta(str(destino), metadataonly=True)
    usar = [c for c in meta.column_names if c.lower() in columnas]
    df, _ = pyreadstat.read_dta(str(destino), usecols=usar)
    df.columns = [c.lower() for c in df.columns]
    for k in KEYS + ['codperso']:
        if k in df:
            df[k] = df[k].astype(str).str.strip()
    return df


def si(col, valor=1):
    """1 si la respuesta es `valor`, 0 si es otra, NaN si no se preguntó."""
    return np.where(col.isna(), np.nan, (col == valor).astype(float))


def personas(zips, crudos):
    """Una fila por residente habitual, con sus filtros e indicadores."""
    m02 = leer(zips['02'], 'enaho01-', set(KEYS + ['codperso', 'ubigeo', 'dominio', 'estrato', 'p203', 'p204', 'p205', 'p206', 'p207', 'p208a', 'facpob07']), crudos)
    resid = ((m02.p204 == 1) & (m02.p205 == 2)) | ((m02.p204 == 2) & (m02.p206 == 1))
    df = m02[resid & ~m02.p203.isin([8, 9]) & m02.p208a.notna() & m02.facpob07.notna()].copy()

    sum_ = leer(zips['34'], 'sumaria-', set(KEYS + ['mieperho', 'gashog2d', 'inghog1d', 'pobreza']), crudos)
    sum_ = sum_[sum_.mieperho > 0]
    df = df.merge(sum_, on=KEYS, how='inner')  # solo hogares con encuesta completa

    m01 = leer(zips['01'], 'enaho01-', set(KEYS + ['p1142', 'p1144', 'p114b1', 'result']), crudos)
    df = df.merge(m01.drop(columns=['result'], errors='ignore'), on=KEYS, how='left')

    usos = [f'p316_{k}' for k, _ in USOS]
    m03 = leer(zips['03'], 'enaho01a-', set(KEYS + ['codperso', 'p301a', 'p314a', 'p314d', 'p316a1'] + usos), crudos)
    df = df.merge(m03, on=KEYS + ['codperso'], how='left')

    seg = [f'p419{i}' for i in range(1, 9)]
    m04 = leer(zips['04'], 'enaho01a-', set(KEYS + ['codperso'] + seg), crudos)
    df = df.merge(m04, on=KEYS + ['codperso'], how='left')

    ing = ['i524a1', 'd529t', 'i530a', 'd536', 'i538a1', 'd540t', 'i541a', 'd543', 'd544t']
    m05 = leer(zips['05'], 'enaho01a-', set(KEYS + ['codperso', 'ocu500', 'fac500a'] + ing), crudos)
    m05['il'] = m05[ing].fillna(0).sum(axis=1) / 12
    df = df.merge(m05[KEYS + ['codperso', 'ocu500', 'fac500a', 'il']], on=KEYS + ['codperso'], how='left')

    out = pd.DataFrame({
        'hog': df[KEYS].agg('-'.join, axis=1),
        'dep': df.ubigeo.astype(str).str.zfill(6).str[:2],
        'lm': df.dominio == 8,
        'area': np.where(df.estrato <= 5, 'u', 'r'),
        'sexo': np.where(df.p207 == 1, 'm', 'f'),
        'edad': df.p208a,
        'w': df.facpob07,
        'gpc': df.gashog2d / 12 / df.mieperho,
        'gh': df.gashog2d / 12,
        'ipc': df.inghog1d / 12 / df.mieperho,
        'ih': df.inghog1d / 12,
        'pobre': np.where(df.pobreza.isna(), np.nan, df.pobreza.isin([1, 2]).astype(float)),
        'pobext': si(df.pobreza, 1),
        'tam': df.mieperho,
        'intcasa': si(df.p1144),  # incluye datos móviles
        'intfija': np.where(df.p1144 == 0, 0.0, si(df.p114b1)),
        'celhog': si(df.p1142),
    })
    niv = df.p301a
    grupo = niv.map({1: 0, 2: 0, 12: 0, 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 3, 9: 4, 10: 4, 11: 4})
    for i in range(len(EDU)):
        out[f'edu{i}'] = np.where(grupo.isna(), np.nan, (grupo == i).astype(float))
    out['sec'] = np.where(grupo.isna(), np.nan, niv.isin([6, 7, 8, 9, 10, 11]).astype(float))
    tiene = df[seg]
    out['seguro'] = np.where(tiene.isna().all(axis=1), np.nan, (tiene == 1).any(axis=1).astype(float))
    out['sis'] = si(df.p4195)
    out['essalud'] = si(df.p4191)
    out['internet'] = si(df.p314a)
    out['celular'] = np.where(df.p316a1.isna(), np.nan, (df.p316a1 == 1).astype(float))
    usa = df.p314a == 1
    out['diario'] = np.where(usa & df.p314d.notna(), (df.p314d == 1).astype(float), np.nan)
    for k, _ in USOS:
        c = df[f'p316_{k}']
        out[f'uso{k}'] = np.where(usa & c.notna(), (c == 1).astype(float), np.nan)
    # empleo e ingreso laboral: de 14 años o más, con su propio factor
    out['w5'] = df.fac500a
    out['ocu'] = np.where(df.ocu500.isna() | df.fac500a.isna(), np.nan, (df.ocu500 == 1).astype(float))
    out['il'] = np.where(df.ocu500 == 1, df.il, np.nan)
    banda = pd.Series(pd.NA, index=out.index, dtype='object')
    for k, a, b in EDADES:
        banda[(out.edad >= a) & (out.edad <= b)] = k
    out['ageb'] = banda
    return out


def cruces(p):
    """Promedios ponderados por cada combinación de filtros (con «t» = todos)."""
    medias = [c for c in CAMPOS if c not in ('n', 'hh', 'pop')]
    base = p[p.ageb.notna()].copy()
    # Lima Metropolitana (dominio 8, con Callao) también se puede elegir aparte
    base = pd.concat([base, base[base.lm].assign(dep='LM')], ignore_index=True)
    for c in medias:
        w = base['w5'] if c in ('ocu', 'il') else base['w']
        ok = base[c].notna() & w.notna()
        base[f'{c}__v'] = np.where(ok, w, 0)
        base[f'{c}__x'] = np.where(ok, base[c].fillna(0) * w.fillna(0), 0)
    variantes = []
    for todo_dep in (False, True):
        for todo_area in (False, True):
            for todo_edad in (False, True):
                for todo_sexo in (False, True):
                    v = base
                    if todo_dep:
                        v = v[v.dep != 'LM'].assign(dep='00')
                    if todo_edad:
                        v = v[v.edad >= 18].assign(ageb='t')
                    if todo_area:
                        v = v.assign(area='t')
                    if todo_sexo:
                        v = v.assign(sexo='t')
                    variantes.append(v)
    todo = pd.concat(variantes, ignore_index=True)
    claves = ['dep', 'area', 'ageb', 'sexo']
    g = todo.groupby(claves)
    suma = g[[f'{c}__{s}' for c in medias for s in 'vx'] + ['w']].sum()
    n = g.size()
    hh = todo.drop_duplicates(claves + ['hog']).groupby(claves).size()
    celdas = {}
    for key, fila in suma.iterrows():
        vals = [int(n[key]), int(hh[key]), int(round(fila['w']))]
        for c in medias:
            v = fila[f'{c}__v']
            if v <= 0:
                vals.append(None)
                continue
            m = fila[f'{c}__x'] / v
            pct = c not in ('gpc', 'gh', 'ipc', 'ih', 'il', 'tam')
            vals.append(round(m * 100, 1) if pct else round(m, 1) if c == 'tam' else int(round(m)))
        celdas['|'.join(key)] = vals
    return celdas


def main():
    ap = argparse.ArgumentParser(description='Procesa la ENAHO anual del INEI para el widget ENAHO.')
    ap.add_argument('--anio', type=int, required=True)
    ap.add_argument('--codigo', type=int, required=True, help='número de la encuesta en el portal de microdatos')
    ap.add_argument('--crudos', type=Path, default=Path.home() / '.cache' / 'enaho')
    ap.add_argument('--salida', type=Path)
    a = ap.parse_args()
    crudos = a.crudos / str(a.codigo)
    crudos.mkdir(parents=True, exist_ok=True)

    zips, fechas = {}, {}
    for m in ('01', '02', '03', '04', '05', '34'):
        zips[m], fechas[m] = bajar(a.codigo, m, crudos)
    p = personas(zips, crudos)

    # control: pobreza de toda la población (el INEI publica este número)
    ok = p.pobre.notna()
    print(f'personas: {len(p)} · pobreza total: {np.average(p.pobre[ok], weights=p.w[ok]) * 100:.1f}%', file=sys.stderr)

    publicado = dt.datetime.strptime(fechas['34'], '%a, %d %b %Y %H:%M:%S %Z').date().isoformat() if fechas['34'] else None
    out = {
        'survey': 'ENAHO',
        'year': a.anio,
        'edition': f'ENAHO {a.anio} · Metodología actualizada · Condiciones de vida y pobreza · anual (enero–diciembre {a.anio})',
        'published': publicado,
        'processed': dt.date.today().isoformat(),
        'source': 'INEI — Encuesta Nacional de Hogares (microdatos)',
        'url': 'https://proyectos.inei.gob.pe/microdatos/',
        'code': a.codigo,
        'example': False,
        'notes': [
            'Promedios y porcentajes ponderados con los factores de expansión del INEI (facpob07; empleo e ingreso laboral, fac500a).',
            'Montos en soles corrientes por mes (gasto e ingreso del hogar: Sumaria, gashog2d e inghog1d ÷ 12).',
            'Internet en el hogar: conexión fija o datos móviles (p1144); internet fijo: p114b1.',
            'Uso de internet, celular propio y para qué se usa internet: personas de 6 años o más, mes anterior a la encuesta.',
            'La ENAHO no pregunta por redes sociales específicas (Facebook, TikTok, WhatsApp, etc.).',
            'Área: urbana = estratos 1–5 (2 000 habitantes o más); rural = estratos 6–8.',
            'Edad «todas» = 18 años o más.',
        ],
        'filters': {
            'dep': [['00', 'Perú'], ['LM', 'Lima Metropolitana (con Callao)'], *DEPS.items()],
            'area': [['t', 'Urbana y rural'], ['u', 'Urbana'], ['r', 'Rural']],
            'age': [['t', '18 años o más'], *[[k, f'{k} años' if k != '60+' else '60 años o más'] for k, _, _ in EDADES]],
            'sex': [['t', 'Hombres y mujeres'], ['f', 'Mujeres'], ['m', 'Hombres']],
        },
        'edu': EDU,
        'uses': [nombre for _, nombre in USOS],
        'fields': CAMPOS,
        'cells': cruces(p),
    }
    salida = a.salida or RAIZ / 'data' / 'enaho' / f'{a.anio}.json'
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    print(f'{salida} · {len(out["cells"])} cruces · {salida.stat().st_size // 1024} KB', file=sys.stderr)


if __name__ == '__main__':
    main()
