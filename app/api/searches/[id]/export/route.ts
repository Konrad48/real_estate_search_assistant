import ExcelJS from "exceljs";
import { NextRequest, NextResponse } from "next/server";
import { queryListings } from "../../../../../db/listings-repo";
import { getSearch } from "../../../../../db/searches-repo";
import { floorLabel } from "../../../../../lib/normalize";
import { slugify } from "../../../../../lib/warsaw-districts";

// Enrichment flags are 1/0/null, where null means the offer never said.
function yesNo(value: number | null): string {
  if (value == null) return "";
  return value ? "tak" : "nie";
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const searchId = Number(id);
  const search = getSearch(searchId);
  if (!search) return NextResponse.json({ error: "Nie znaleziono listy" }, { status: 404 });

  const rows = queryListings(searchId, { sort: { column: "price_per_m2", direction: "asc" } });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Oferty");
  sheet.columns = [
    { header: "Źródło", key: "source", width: 12 },
    { header: "Tytuł", key: "title", width: 40 },
    { header: "Cena (zł)", key: "price_pln", width: 14 },
    { header: "Powierzchnia (m²)", key: "area_m2", width: 16 },
    { header: "Cena/m²", key: "price_per_m2", width: 12 },
    { header: "Lokalizacja", key: "district", width: 20 },
    { header: "Adres", key: "address_raw", width: 30 },
    { header: "Pokoje", key: "rooms", width: 8 },
    { header: "Piętro", key: "floor", width: 10 },
    { header: "Piętro (nr)", key: "floor_num", width: 10 },
    { header: "Pięter w budynku", key: "total_floors", width: 16 },
    { header: "Prawo własności", key: "ownership_type", width: 26 },
    { header: "Czynsz (zł)", key: "czynsz", width: 12 },
    { header: "Rok budowy", key: "year_built", width: 12 },
    { header: "Stan", key: "condition_state", width: 18 },
    { header: "Balkon", key: "has_balcony", width: 10 },
    { header: "Miejsce postojowe", key: "has_parking", width: 18 },
    { header: "Winda", key: "has_elevator", width: 10 },
    { header: "Data ogłoszenia", key: "listing_date", width: 18 },
    { header: "Aktywne", key: "is_active", width: 10 },
    { header: "Ulubione", key: "is_starred", width: 10 },
    { header: "Odrzucone", key: "is_disliked", width: 10 },
    { header: "Link", key: "source_url", width: 50 },
    { header: "Pobrano", key: "last_scraped_at", width: 20 },
    { header: "Kontakt — imię", key: "contact_name", width: 20 },
    { header: "Kontakt — telefon", key: "contact_phone", width: 18 },
    { header: "Komentarz", key: "comment", width: 40 },
    { header: "Księga wieczysta", key: "has_land_register", width: 16 },
    { header: "Numer KW", key: "land_register_number", width: 20 },
    { header: "Grunty uregulowane", key: "land_regulated", width: 18 },
    { header: "Hipoteka / obciążenia", key: "has_encumbrance", width: 20 },
    { header: "Układ", key: "layout", width: 30 },
    { header: "Cena do negocjacji", key: "price_negotiable", width: 18 },
    { header: "Podłoga", key: "flooring", width: 20 },
    { header: "Instalacja elektryczna", key: "wiring", width: 20 },
    { header: "Warunki prowizji", key: "commission_terms", width: 30 },
    { header: "Lokatorzy", key: "has_tenants", width: 10 },
    { header: "Powód sprzedaży", key: "sale_reason", width: 30 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow({
      source: row.source,
      title: row.title,
      price_pln: row.price_pln,
      area_m2: row.area_m2,
      price_per_m2: row.price_per_m2,
      district: row.district,
      address_raw: row.address_raw,
      rooms: row.rooms,
      floor: floorLabel(row.floor_num, row.total_floors) ?? row.floor,
      floor_num: row.floor_num,
      total_floors: row.total_floors,
      ownership_type: row.ownership_type,
      czynsz: row.czynsz,
      year_built: row.year_built,
      condition_state: row.condition_state,
      has_balcony: yesNo(row.has_balcony),
      has_parking: yesNo(row.has_parking),
      has_elevator: yesNo(row.has_elevator),
      listing_date: row.listing_date,
      is_active: row.is_active ? "tak" : "nieaktualne",
      is_starred: row.is_starred ? "★" : "",
      is_disliked: row.is_disliked ? "tak" : "",
      source_url: row.source_url,
      last_scraped_at: row.last_scraped_at,
      contact_name: row.contact_name,
      contact_phone: row.contact_phone,
      comment: row.comment,
      has_land_register: yesNo(row.has_land_register),
      land_register_number: row.land_register_number,
      land_regulated: yesNo(row.land_regulated),
      has_encumbrance: yesNo(row.has_encumbrance),
      layout: row.layout,
      price_negotiable: yesNo(row.price_negotiable),
      flooring: row.flooring,
      wiring: row.wiring,
      commission_terms: row.commission_terms,
      has_tenants: yesNo(row.has_tenants),
      sale_reason: row.sale_reason,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const namePart = slugify(search.name).slice(0, 40) || "lista";
  const filename = `${namePart}-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
