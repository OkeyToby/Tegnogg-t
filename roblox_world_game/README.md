# Roblox World Conquest Prototype

Dette katalog indeholder prototypeskripter og instruktioner til at opbygge et simpelt verdenskonkurrence-spil i Roblox Studio.

## Opsætning

1. I Roblox Studio: Brug tjenesten **Teams** til at oprette et hold for hvert land (f.eks. Blå = Danmark, Rød = Tyskland, Grøn = Frankrig).
2. I Workspace: Opret flade dele (Parts) for hvert territorium, og navngiv dem som `Territory_Europe`, `Territory_Africa` osv. Skalér og placer dem, så de svarer til regioner på kortet.
3. Under **ServerScriptService**: Opret et Script med navnet `WorldWarGame` og indsæt koden fra `worldwar_game_script.lua`.
4. Spillerne tildeles til hold manuelt eller via din egen logik. Teamfarven bestemmer, hvilke territorier de kan erobre.
5. En spiller erobrer et territorium ved at stå på territoriets base-del. Når der kun er spillere fra ét hold på territoriet, bliver territoriet ejet af det hold, og delens farve ændres til holdets farve.
6. Erobrede territorier genererer ressourcer (én ressource pr. tick) for spillere på det kontrollerende hold. Du kan justere mængden eller tilføje yderligere mekanikker som enheders spawners eller teknologiforskning.

Dette er kun et udgangspunkt – du kan bygge videre på systemet med flere enhedstyper, forskning, alliancer og globale begivenheder.
