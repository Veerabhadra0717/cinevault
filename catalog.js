// Catalogue: cities, cinemas, movies and formats.
// Edit this file to add movies or cinemas; showtimes are generated from it (see db.js).
//
// Movies are real releases in Indian cinemas around October–November 2026.
// Titles, release dates, languages, directors, cast and premises come from public
// listings (Wikipedia film lists, Esquire India, WION, Filmibeat, Sacnilk) checked on 21 Oct 2026.
// Anything those sources didn't give (runtime, certificate, genre, synopsis) is left out
// rather than guessed. The cinemas, showtimes, formats and prices are simulated.

const LANGUAGES = ['Hindi', 'English', 'Kannada', 'Tamil', 'Telugu', 'Malayalam', 'Marathi', 'Bengali', 'Punjabi', 'Gujarati'];

// Extra rupees per seat on top of the row price
const FORMATS = { '2D': 0, '3D': 50, 'IMAX 2D': 150, 'IMAX 3D': 200, '4DX': 250 };

// lang: the regional language, used to decide which films play most and which dubs are shown
const CITIES = [
  { id: 'bengaluru', name: 'Bengaluru', lang: 'Kannada' },
  { id: 'mumbai', name: 'Mumbai', lang: 'Marathi' },
  { id: 'delhi', name: 'Delhi NCR', lang: 'Punjabi' },
  { id: 'hyderabad', name: 'Hyderabad', lang: 'Telugu' },
  { id: 'chennai', name: 'Chennai', lang: 'Tamil' },
  { id: 'kochi', name: 'Kochi', lang: 'Malayalam' },
  { id: 'kolkata', name: 'Kolkata', lang: 'Bengali' },
  { id: 'ahmedabad', name: 'Ahmedabad', lang: 'Gujarati' }
];

const THEATRES = [
  { id: 'blr-orion', city: 'bengaluru', name: 'Cinevault Orion', area: 'Rajajinagar', formats: ['2D', '3D', 'IMAX 2D', 'IMAX 3D'] },
  { id: 'blr-forum', city: 'bengaluru', name: 'Cinevault Forum', area: 'Koramangala', formats: ['2D', '3D', '4DX'] },
  { id: 'blr-gold', city: 'bengaluru', name: 'Cinevault Gold', area: 'Indiranagar', formats: ['2D'] },
  { id: 'mum-phoenix', city: 'mumbai', name: 'Cinevault Phoenix', area: 'Lower Parel', formats: ['2D', '3D', 'IMAX 2D', 'IMAX 3D'] },
  { id: 'mum-andheri', city: 'mumbai', name: 'Cinevault Infiniti', area: 'Andheri West', formats: ['2D', '3D', '4DX'] },
  { id: 'del-saket', city: 'delhi', name: 'Cinevault Select', area: 'Saket', formats: ['2D', '3D', 'IMAX 2D', 'IMAX 3D'] },
  { id: 'del-cyber', city: 'delhi', name: 'Cinevault Cyber Hub', area: 'Gurugram', formats: ['2D', '4DX'] },
  { id: 'hyd-banjara', city: 'hyderabad', name: 'Cinevault Banjara', area: 'Banjara Hills', formats: ['2D', '3D', 'IMAX 2D', 'IMAX 3D'] },
  { id: 'hyd-kukatpally', city: 'hyderabad', name: 'Cinevault Nexus', area: 'Kukatpally', formats: ['2D', '3D'] },
  { id: 'che-velachery', city: 'chennai', name: 'Cinevault Grand', area: 'Velachery', formats: ['2D', '3D', 'IMAX 2D', 'IMAX 3D'] },
  { id: 'che-tnagar', city: 'chennai', name: 'Cinevault Ritz', area: 'T. Nagar', formats: ['2D', '4DX'] },
  { id: 'koc-lulu', city: 'kochi', name: 'Cinevault Marine', area: 'Edappally', formats: ['2D', '3D', 'IMAX 2D'] },
  { id: 'koc-fort', city: 'kochi', name: 'Cinevault Heritage', area: 'Fort Kochi', formats: ['2D'] },
  { id: 'kol-saltlake', city: 'kolkata', name: 'Cinevault City Centre', area: 'Salt Lake', formats: ['2D', '3D', 'IMAX 2D'] },
  { id: 'kol-park', city: 'kolkata', name: 'Cinevault Park Street', area: 'Park Street', formats: ['2D'] },
  { id: 'ahd-sg', city: 'ahmedabad', name: 'Cinevault One', area: 'SG Highway', formats: ['2D', '3D', '4DX'] },
  { id: 'ahd-navrang', city: 'ahmedabad', name: 'Cinevault Navrangpura', area: 'Navrangpura', formats: ['2D'] }
];

// releaseDate: 'YYYY-MM-DD'. Before that day the movie is "Coming soon"; from that day it gets showtimes.
// languages: first one is the original; the rest are dubbed versions.
// formats: the formats our (simulated) cinemas screen it in.
// colors: for the drawn poster. Optional fields: genres, director, cast, synopsis.
const MOVIES = [
  /* ----- Now showing ----- */

  // Hindi
  {
    slug: 'drishyam-the-conclusion', title: 'Drishyam: The Conclusion', languages: ['Hindi'], genres: ['Thriller', 'Crime'],
    releaseDate: '2026-10-02', formats: ['2D', 'IMAX 2D'], colors: ['#1f2937', '#fbbf24'],
    cast: ['Ajay Devgn', 'Tabu', 'Jaideep Ahlawat'],
    synopsis: 'Vijay Salgaonkar has protected his family with the same story for years. Now Meera Deshmukh wants revenge, and SP Rajveer Singh Tomar is brought in to open the case again.'
  },
  {
    slug: 'prahaar', title: 'Prahaar: The Untold Story of Ujjwal Nikam', languages: ['Hindi'], genres: ['Biography', 'Courtroom drama'],
    releaseDate: '2026-10-16', formats: ['2D'], colors: ['#7f1d1d', '#fde68a'],
    cast: ['Rajkummar Rao', 'Wamiqa Gabbi', 'Jaideep Ahlawat', 'Sikandar Kher'],
    synopsis: 'Based on Ujjwal Nikam, the Special Public Prosecutor in the 26/11 Mumbai terror attack case.'
  },
  {
    slug: 'nayyi-navelli', title: 'Nayyi Navelli', languages: ['Hindi'],
    releaseDate: '2026-10-16', formats: ['2D'], colors: ['#be185d', '#fef3c7'],
    cast: ['Yami Gautam'],
    synopsis: 'A newlywed moves into a quarrelling household that turns strangely peaceful after she arrives, and her in-laws start to suspect she is a witch.'
  },
  {
    slug: 'prem-keetanu', title: 'Prem Keetanu', languages: ['Hindi'], genres: ['Comedy', 'Drama'],
    releaseDate: '2026-10-02', formats: ['2D'], colors: ['#0e7490', '#fde047'],
    director: 'Apoorv Singh Karki', cast: ['Veer Pahariya', 'Aafiya Sayed', 'Aparshakti Khurana'],
    synopsis: 'A group of college friends deals with heartbreak, career pressure and a little romance.'
  },

  // English
  {
    slug: 'street-fighter', title: 'Street Fighter', languages: ['English'], genres: ['Action'],
    releaseDate: '2026-10-16', formats: ['2D', '3D', 'IMAX 3D', '4DX'], colors: ['#1e3a8a', '#f97316'],
    cast: ['Andrew Koji', 'Noah Centineo', 'Callina Liang'],
    synopsis: 'Based on the Capcom game. Estranged training partners Ryu and Ken Masters reunite when Chun-Li recruits them for the World Warrior Tournament.'
  },
  {
    slug: 'whalefall', title: 'Whalefall', languages: ['English'], genres: ['Thriller', 'Survival'],
    releaseDate: '2026-10-16', formats: ['2D', 'IMAX 2D', '4DX'], colors: ['#082f49', '#7dd3fc'],
    cast: ['Austin Abrams', 'Josh Brolin'],
    synopsis: 'Diving off the California coast to recover his late father’s remains, a young man is swallowed by a sperm whale, with one hour of oxygen left.'
  },
  {
    slug: 'the-social-reckoning', title: 'The Social Reckoning', languages: ['English'], genres: ['Drama'],
    releaseDate: '2026-10-09', formats: ['2D'], colors: ['#111827', '#60a5fa'],
    director: 'Aaron Sorkin', cast: ['Jeremy Strong', 'Mikey Madison', 'Jeremy Allen White'],
    synopsis: 'Facebook engineer Frances Haugen works with Wall Street Journal reporter Jeff Horwitz to expose the company’s secrets, drawing on the 2021 “Facebook Files”.'
  },
  {
    slug: 'other-mommy', title: 'Other Mommy', languages: ['English'], genres: ['Horror'],
    releaseDate: '2026-10-09', formats: ['2D'], colors: ['#18181b', '#a3e635'],
    cast: ['Jessica Chastain', 'Arabella Olivia Clark'],
    synopsis: 'An eight-year-old finds a sinister entity in her closet that looks exactly like her mother. Chastain plays both mothers.'
  },
  {
    slug: 'verity', title: 'Verity', languages: ['English'], genres: ['Thriller'],
    releaseDate: '2026-10-02', formats: ['2D'], colors: ['#3f1d38', '#f9a8d4'],
    cast: ['Dakota Johnson', 'Anne Hathaway', 'Josh Hartnett'],
    synopsis: 'Adapted from Colleen Hoover’s novel. A struggling writer hired to finish an injured author’s books finds an unpublished autobiography full of chilling confessions.'
  },
  {
    slug: 'digger', title: 'Digger', languages: ['English'], genres: ['Satire'],
    releaseDate: '2026-10-02', formats: ['2D', 'IMAX 2D'], colors: ['#422006', '#facc15'],
    director: 'Alejandro G. Iñárritu', cast: ['Tom Cruise'],
    synopsis: 'An oil tycoon faces ruin from a climate disaster of his own making, and sets out to prove he is humanity’s saviour.'
  },

  // Tamil
  {
    slug: 'jailer-2', title: 'Jailer 2', languages: ['Tamil', 'Kannada'], genres: ['Action'],
    releaseDate: '2026-10-15', formats: ['2D', 'IMAX 2D', '4DX'], colors: ['#450a0a', '#fbbf24'],
    director: 'Nelson Dilipkumar', cast: ['Rajinikanth'],
    synopsis: 'Retired “Tiger” Muthuvel Pandian has to protect his family when a new underworld empire comes after them. Music by Anirudh Ravichander.'
  },

  // Telugu
  {
    slug: 'ranabaali', title: 'Ranabaali', languages: ['Telugu', 'Tamil', 'Hindi'], genres: ['Action', 'Period'],
    releaseDate: '2026-10-16', formats: ['2D', 'IMAX 2D'], colors: ['#78350f', '#fcd34d'],
    cast: ['Vijay Deverakonda', 'Arnold Vosloo'],
    synopsis: 'Set during the Great Famine of 1876–78, a warrior rises against British forces to shield his people.'
  },
  {
    slug: 'vishwambhara', title: 'Vishwambhara', languages: ['Telugu'], genres: ['Fantasy'],
    releaseDate: '2026-10-16', formats: ['2D', '3D', 'IMAX 3D'], colors: ['#312e81', '#f0abfc'],
    cast: ['Chiranjeevi'],
    synopsis: 'An epic inspired by Hindu folklore: a young prince travels across the Lokas, the realms of the universe, to meet his destiny.'
  },

  // Malayalam
  {
    slug: 'bethlehem-kudumba-unit', title: 'Bethlehem Kudumba Unit', languages: ['Malayalam'], genres: ['Romance', 'Comedy'],
    releaseDate: '2026-08-21', formats: ['2D'], colors: ['#065f46', '#fde68a'],
    director: 'Girish A. D.', cast: ['Nivin Pauly', 'Mamitha Baiju', 'Sangeeth Prathap', 'Vinay Forrt']
  },

  // Kannada
  {
    slug: 'bail', title: 'Bail', languages: ['Kannada'],
    releaseDate: '2026-10-02', formats: ['2D'], colors: ['#1c1917', '#f87171'],
    director: 'Pavan Wadeyar', cast: ['Shiva Rajkumar', 'Jayaram', 'P. Sai Kumar', 'Yogesh']
  },
  {
    slug: 'huli-beera', title: 'Huli Beera', languages: ['Kannada'],
    releaseDate: '2026-10-02', formats: ['2D'], colors: ['#ca8a04', '#1c1917'],
    director: 'Madarangi Mallikarjun', cast: ['Rahul Anjan', 'Vanu Patil', 'Chaitra Totad', 'Rangayana Raghu']
  },
  {
    slug: 'trikaaram', title: 'Trikaaram', languages: ['Kannada'],
    releaseDate: '2026-10-02', formats: ['2D'], colors: ['#14532d', '#bef264'],
    director: 'Dileep Kumar J. R.', cast: ['Harshavardhan Kesari', 'Nischitha Shetty', 'Bala Rajwadi']
  },

  // Marathi
  {
    slug: 'sohla', title: 'Sohla', languages: ['Marathi'],
    releaseDate: '2026-10-16', formats: ['2D'], colors: ['#9d174d', '#fbcfe8'],
    director: 'Saaikat Bagbaan', cast: ['Pravin Dalimbkar', 'Vaishnavi Ghodke', 'Devdatta Ghone']
  },
  {
    slug: 'pach-footacha-bachchan', title: 'Pach Footacha Bachchan', languages: ['Marathi'],
    releaseDate: '2026-10-09', formats: ['2D'], colors: ['#c2410c', '#fef3c7'],
    director: 'Kaustubh Deshpande', cast: ['Shruti Madhudeep', 'Gauri Nalawade', 'Shashank Shende']
  },
  {
    slug: 'afratafri', title: 'Afratafri', languages: ['Marathi'],
    releaseDate: '2026-10-09', formats: ['2D'], colors: ['#0f766e', '#fde047'],
    director: 'Milind Kavde', cast: ['Mohan Agashe', 'Sanjay Narvekar', 'Asavari Joshi']
  },
  {
    slug: 'aali-mothi-shahani', title: 'Aali Mothi Shahani', languages: ['Marathi'],
    releaseDate: '2026-10-02', formats: ['2D'], colors: ['#6d28d9', '#fde68a'],
    director: 'Anand Gokhale', cast: ['Hruta Durgule', 'Sarang Sathaye']
  },

  // Bengali
  {
    slug: 'bohurupi-the-golden-daku', title: 'Bohurupi: The Golden Daku', languages: ['Bengali'],
    releaseDate: '2026-10-15', formats: ['2D'], colors: ['#713f12', '#fcd34d'],
    director: 'Shiboprosad Mukherjee, Nandita Roy', cast: ['Jisshu Sengupta', 'Shiboprosad Mukherjee', 'Sohini Sarkar', 'Koushani Mukherjee']
  },
  {
    slug: 'the-eken-kerala-e-kurukshetra', title: 'The Eken: Kerala-e Kurukshetra', languages: ['Bengali'],
    releaseDate: '2026-10-16', formats: ['2D'], colors: ['#134e4a', '#99f6e4'],
    director: 'Joydeep Mukherjee', cast: ['Anirban Chakrabarti', 'Raima Sen', 'Ritwick Chakraborty', 'Kamaleswar Mukherjee']
  },

  // Punjabi
  {
    slug: 'thaapi', title: 'Thaapi', languages: ['Punjabi'], genres: ['Sports', 'Drama'],
    releaseDate: '2026-10-16', formats: ['2D'], colors: ['#166534', '#fbbf24'],
    director: 'Jagdeep Warring', cast: ['Neeru Bajwa', 'Sunny Singh', 'Simran Chahal', 'Nikita Grover']
  },

  // Gujarati
  {
    slug: 'andhkar', title: 'Andhkar', languages: ['Gujarati'], genres: ['Suspense', 'Thriller'],
    releaseDate: '2026-10-16', formats: ['2D'], colors: ['#0c0a09', '#fb923c'],
    director: 'Hiren Jadvani', cast: ['Ekta Savani', 'Vishal Solanki', 'Chetan Daiya', 'Rinkal Leuva']
  },
  {
    slug: 'mitrata', title: 'Mitrata', languages: ['Gujarati'], genres: ['Comedy'],
    releaseDate: '2026-09-25', formats: ['2D'], colors: ['#c026d3', '#fef08a'],
    director: 'Oneel Karnik', cast: ['Viraj Ghelani', 'Deep Vaidya', 'Vishal Parekh', 'Vishwaa Joshi']
  },

  /* ----- Coming soon ----- */
  {
    slug: 'udta-teer', title: 'Udta Teer', languages: ['Hindi'], genres: ['Spy'],
    releaseDate: '2026-10-23', formats: ['2D'], colors: ['#14532d', '#d9f99d'],
    cast: ['Ayushmann Khurrana'],
    synopsis: 'A Pakistani spy sent into India on a secret mission loses his memory and forgets which country he belongs to.'
  },
  {
    slug: 'main-na-raha-mera', title: 'Main Na Raha Mera', languages: ['Hindi'], genres: ['Romance', 'Drama'],
    releaseDate: '2026-10-23', formats: ['2D'], colors: ['#9f1239', '#fecdd3'],
    cast: ['Adhyayan Suman', 'Divita Rai'],
    synopsis: 'A man raised on 90s Bollywood romances meets his college crush again after twelve years.'
  },
  {
    slug: 'clayface', title: 'Clayface', languages: ['English'], genres: ['Horror'],
    releaseDate: '2026-10-23', formats: ['2D', 'IMAX 2D'], colors: ['#292524', '#d6d3d1'],
    cast: ['Tom Rhys Harries'],
    synopsis: 'From DC: an actor disfigured in an attack injects himself with a substance to restore his face, and finds he can reshape his face and body.'
  },
  {
    slug: 'klara-and-the-sun', title: 'Klara and the Sun', languages: ['English'], genres: ['Drama'],
    releaseDate: '2026-10-23', formats: ['2D'], colors: ['#fef3c7', '#b45309'],
    cast: ['Jenna Ortega', 'Mia Tharia', 'Amy Adams'],
    synopsis: 'Klara, an “Artificial Friend”, joins a family where a daughter and her mother have drifted apart, and tries to bring them back together.'
  },
  {
    slug: 'kapuskonda', title: 'Kapuskonda', languages: ['Marathi'],
    releaseDate: '2026-10-23', formats: ['2D'], colors: ['#365314', '#ecfccb'],
    director: 'Sachin Mohite', cast: ['Sachin Pilgaonkar', 'Madhurani Gokhale', 'Bhushan Patil']
  },
  {
    slug: 'damru', title: 'Damru', languages: ['Gujarati'], genres: ['Comedy'],
    releaseDate: '2026-10-23', formats: ['2D'], colors: ['#b91c1c', '#fde68a'],
    director: 'Hardik J Pareekh', cast: ['Sanjay Goradia', 'Nakshraj', 'Nirav Vaidya', 'Nirali Oza']
  },
  {
    slug: 'wicker', title: 'Wicker', languages: ['English'],
    releaseDate: '2026-10-30', formats: ['2D'], colors: ['#3f3f46', '#fcd34d'],
    cast: ['Olivia Colman', 'Peter Dinklage', 'Alexander Skarsgård'],
    synopsis: 'An outcast fisherwoman orders a husband made of wicker, and their romance stirs up jealousy across the village.'
  },
  {
    slug: 'sadhak-bamakhyapa', title: 'Sadhak Bamakhyapa', languages: ['Bengali'],
    releaseDate: '2026-11-06', formats: ['2D'], colors: ['#7c2d12', '#fed7aa'],
    director: 'Sayantan Ghosal', cast: ['Sabyasachi Chowdhury', 'Payel De', 'Saheb Chatterjee']
  },
  {
    slug: 'fafda-jalebi', title: 'Fafda Jalebi', languages: ['Gujarati'], genres: ['Comedy'],
    releaseDate: '2026-11-06', formats: ['2D'], colors: ['#ea580c', '#fef9c3'],
    director: 'Pallav Parikh', cast: ['Malhar Thakar', 'Abhinay Banker', 'Puja Joshi', 'Heena Varde']
  },
  {
    // Sources disagree on the exact day (5, 6 or 8 November)
    slug: 'ramayana-part-one', title: 'Ramayana: Part One', languages: ['Hindi'], genres: ['Mythology', 'Epic'],
    releaseDate: '2026-11-06', formats: ['2D', '3D', 'IMAX 3D'], colors: ['#1e3a8a', '#fcd34d'],
    cast: ['Ranbir Kapoor', 'Sai Pallavi']
  },
  {
    slug: 'bhogi', title: 'Bhogi', languages: ['Telugu'],
    releaseDate: '2026-11-12', formats: ['2D'], colors: ['#7c2d12', '#fdba74'],
    cast: ['Sharwanand']
  },
  {
    slug: 'pocket-novel', title: 'Pocket Novel', languages: ['Tamil'],
    releaseDate: '2026-11-13', formats: ['2D'], colors: ['#1e293b', '#fda4af'],
    cast: ['Vijay Sethupathi']
  }
];

const MOVIE_BY_SLUG = new Map(MOVIES.map(m => [m.slug, m]));
const THEATRE_BY_ID = new Map(THEATRES.map(t => [t.id, t]));
const CITY_BY_ID = new Map(CITIES.map(c => [c.id, c]));

module.exports = { LANGUAGES, FORMATS, CITIES, THEATRES, MOVIES, MOVIE_BY_SLUG, THEATRE_BY_ID, CITY_BY_ID };
