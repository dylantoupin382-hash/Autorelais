export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true });
    }

    if (url.pathname === "/api/vendeur" && request.method === "POST") {
      try {
        const data = await request.json();

        const required = [
          "prenom",
          "nom",
          "telephone",
          "email",
          "ville",
          "marque",
          "modele"
        ];

        for (const key of required) {
          if (!String(data[key] ?? "").trim()) {
            return json({ error: "Champ requis : " + key }, 400);
          }
        }

        const vendeur = await env.DB.prepare(`
          INSERT INTO vendeurs
          (prenom, nom, telephone, email, ville)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          String(data.prenom).trim(),
          String(data.nom).trim(),
          String(data.telephone).trim(),
          String(data.email).trim(),
          String(data.ville).trim()
        ).run();

        const vendeurId = vendeur.meta.last_row_id;

        await env.DB.prepare(`
          INSERT INTO vehicules
          (
            vendeur_id,
            marque,
            modele,
            annee,
            kilometrage,
            prix_souhaite,
            energie,
            boite,
            immatriculation,
            description,
            statut
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nouveau')
        `).bind(
          vendeurId,
          String(data.marque).trim(),
          String(data.modele).trim(),
          Number(data.annee) || null,
          Number(data.kilometrage) || null,
          Number(data.prix_souhaite) || null,
          String(data.energie ?? "").trim(),
          String(data.boite ?? "").trim(),
          String(data.immatriculation ?? "").trim(),
          String(data.description ?? "").trim()
        ).run();

        return json({
          ok: true,
          vendeur_id: vendeurId
        }, 201);

      } catch (error) {
        return json({
          error: "Impossible d'enregistrer la demande."
        }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
