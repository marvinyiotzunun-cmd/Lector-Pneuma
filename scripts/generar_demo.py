"""Genera los libros de muestra (Reina-Valera 1909, dominio público) en public/demo/.
Uso: python3 scripts/generar_demo.py   (requiere reportlab para el PDF)"""
import os, zipfile
from html import escape

RAIZ = os.path.join(os.path.dirname(__file__), "..", "public", "demo")

SALMOS = [
    ("Salmo 1", "Los dos caminos", [
        "Bienaventurado el varón que no anduvo en consejo de malos, ni estuvo en camino de pecadores, ni en silla de escarnecedores se ha sentado;",
        "Antes en la ley de Jehová está su delicia, y en su ley medita de día y de noche.",
        "Y será como el árbol plantado junto á arroyos de aguas, que da su fruto en su tiempo, y su hoja no cae; y todo lo que hace, prosperará.",
        "No así los malos: sino como el tamo que arrebata el viento.",
        "Por tanto no se levantarán los malos en el juicio, ni los pecadores en la congregación de los justos.",
        "Porque Jehová conoce el camino de los justos; mas la senda de los malos perecerá."]),
    ("Salmo 23", "El buen pastor", [
        "Jehová es mi pastor; nada me faltará.",
        "En lugares de delicados pastos me hará yacer: junto á aguas de reposo me pastoreará.",
        "Confortará mi alma; guiaráme por sendas de justicia por amor de su nombre.",
        "Aunque ande en valle de sombra de muerte, no temeré mal alguno; porque tú estarás conmigo: tu vara y tu cayado me infundirán aliento.",
        "Aderezarás mesa delante de mí, en presencia de mis angustiadores: ungiste mi cabeza con aceite: mi copa está rebosando.",
        "Ciertamente el bien y la misericordia me seguirán todos los días de mi vida: y en la casa de Jehová moraré por largos días."]),
    ("Salmo 121", "Jehová es tu guardador", [
        "Alzaré mis ojos á los montes, de donde vendrá mi socorro.",
        "Mi socorro viene de Jehová, que hizo los cielos y la tierra.",
        "No dará tu pie al resbaladero; ni se dormirá el que te guarda.",
        "He aquí, no se adormecerá ni dormirá el que guarda á Israel.",
        "Jehová es tu guardador: Jehová es tu sombra á tu mano derecha.",
        "El sol no te fatigará de día, ni la luna de noche.",
        "Jehová te guardará de todo mal: él guardará tu alma.",
        "Jehová guardará tu salida y tu entrada, desde ahora y para siempre."]),
]

JUAN = [
    "En el principio era el Verbo, y el Verbo era con Dios, y el Verbo era Dios.",
    "Este era en el principio con Dios.",
    "Todas las cosas por él fueron hechas, y sin él nada de lo que es hecho, fué hecho.",
    "En él estaba la vida, y la vida era la luz de los hombres.",
    "Y la luz en las tinieblas resplandece; mas las tinieblas no la comprendieron.",
    "Fué un hombre enviado de Dios, el cual se llamaba Juan.",
    "Este vino por testimonio, para que diese testimonio de la luz, para que todos creyesen por él.",
    "No era él la luz, sino para que diese testimonio de la luz.",
    "Aquel era la luz verdadera, que alumbra á todo hombre que viene á este mundo.",
    "En el mundo estaba, y el mundo fué hecho por él; y el mundo no le conoció.",
    "A lo suyo vino, y los suyos no le recibieron.",
    "Mas á todos los que le recibieron, dióles potestad de ser hechos hijos de Dios, á los que creen en su nombre:",
    "Los cuales no son engendrados de sangre, ni de voluntad de carne, ni de voluntad de varón, mas de Dios.",
    "Y aquel Verbo fué hecho carne, y habitó entre nosotros (y vimos su gloria, gloria como del unigénito del Padre), lleno de gracia y de verdad.",
]


def epub(ruta, titulo, autor, capitulos):
    def xhtml(cuerpo, t):
        return ('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n'
                '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="es">'
                f'<head><meta charset="utf-8"/><title>{escape(t)}</title></head><body>{cuerpo}</body></html>')
    with zipfile.ZipFile(ruta, "w") as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml",
                   '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                   '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        items, spine, nav = [], [], []
        for i, (t, sub, versos) in enumerate(capitulos, 1):
            cuerpo = f"<h1>{escape(t)}</h1><p><em>{escape(sub)}</em></p>" + "".join(
                f"<p><sup>{n}</sup> {escape(v)}</p>" for n, v in enumerate(versos, 1))
            z.writestr(f"OEBPS/cap{i}.xhtml", xhtml(cuerpo, t), compress_type=zipfile.ZIP_DEFLATED)
            items.append(f'<item id="cap{i}" href="cap{i}.xhtml" media-type="application/xhtml+xml"/>')
            spine.append(f'<itemref idref="cap{i}"/>')
            nav.append(f'<li><a href="cap{i}.xhtml">{escape(t)}</a></li>')
        z.writestr("OEBPS/nav.xhtml", xhtml(f'<nav epub:type="toc"><h1>Contenido</h1><ol>{"".join(nav)}</ol></nav>', "Contenido"))
        z.writestr("OEBPS/content.opf",
                   '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">'
                   f'<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">pneuma-demo-{escape(titulo)}</dc:identifier>'
                   f'<dc:title>{escape(titulo)}</dc:title><dc:creator>{escape(autor)}</dc:creator><dc:language>es</dc:language>'
                   '<meta property="dcterms:modified">2026-10-24T00:00:00Z</meta></metadata>'
                   f'<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>{"".join(items)}</manifest>'
                   f'<spine>{"".join(spine)}</spine></package>')


def pdf(ruta):
    from reportlab.lib.pagesizes import A5
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
    est = getSampleStyleSheet()
    cuerpo = est["BodyText"]; cuerpo.fontName = "Times-Roman"; cuerpo.fontSize = 12; cuerpo.leading = 18
    hist = [Spacer(1, 120), Paragraph("El Verbo hecho carne", est["Title"]),
            Paragraph("Juan 1:1-14 · Reina-Valera 1909", est["Normal"]), PageBreak()]
    for n, v in enumerate(JUAN, 1):
        hist.append(Paragraph(f"<super>{n}</super> {escape(v)}", cuerpo))
        hist.append(Spacer(1, 6))
        if n == 5:
            hist.append(PageBreak())
    SimpleDocTemplate(ruta, pagesize=A5, title="El Verbo hecho carne", author="Reina-Valera 1909").build(hist)


if __name__ == "__main__":
    os.makedirs(RAIZ, exist_ok=True)
    epub(os.path.join(RAIZ, "salmos-escogidos.epub"), "Salmos escogidos", "Reina-Valera 1909", SALMOS)
    pdf(os.path.join(RAIZ, "el-verbo-hecho-carne.pdf"))
    print("Listo:", os.listdir(RAIZ))
