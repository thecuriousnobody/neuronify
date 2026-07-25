// The report taxonomy, for the resident-facing picker: every category with its
// plain-language label, the department it routes to, and that category's form.
// Lazily fetched by /report/chat when someone wants to correct the auto-detected
// category, so a mis-read never traps them in the wrong questions.
import { CATEGORIES, formForCategory, departmentFor, TEMPLATE_FORM_CITY } from '@/engine';

export const runtime = 'nodejs';

export async function GET() {
  const categories = CATEGORIES.map((c) => {
    const form = formForCategory(c.key);
    return {
      key: c.key,
      label: c.label,
      department: departmentFor(TEMPLATE_FORM_CITY, c.key),
      form: { key: form.key, title: form.title, fields: form.fields },
    };
  });
  return Response.json({ categories });
}
