import sqlite3
import json

def export_db_to_json(db_path, json_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # We only care about the spells table
    cursor.execute("SELECT * FROM spells")
    rows = cursor.fetchall()
    
    spells = []
    for row in rows:
        spell_dict = dict(row)
        # Parse the JSON string representation into a proper list
        if spell_dict.get('class_spell_lists'):
            try:
                spell_dict['class_spell_lists'] = json.loads(spell_dict['class_spell_lists'])
            except json.JSONDecodeError:
                pass # If it's not valid JSON, leave it as is
                
        spells.append(spell_dict)
    
    # Write just the spells list (wrapped in an object with a 'spells' key)
    result = { "spells": spells }
        
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        
    conn.close()
    print(f"Exported {len(spells)} spells to {json_path}")

if __name__ == '__main__':
    export_db_to_json('spells.sqlite3', 'spells.json')
