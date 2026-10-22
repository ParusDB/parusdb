-- Données de démonstration (bidon) : source SQL pour la validation e2e du
-- moteur ELT. Jeu minimal réaliste avec colonnes de curseur incrémental
-- (updated_at) pour valider les deux modes d'insertion.

create table customers (
    id serial primary key,
    name text not null,
    email text not null unique,
    city text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table orders (
    id serial primary key,
    customer_id integer not null references customers (id),
    amount numeric(10, 2) not null,
    status text not null,
    order_date date not null default current_date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

insert into customers (name, email, city) values
    ('Camille Laurent', 'camille.laurent@exemple.fr', 'Lyon'),
    ('Thomas Bernard', 'thomas.bernard@exemple.fr', 'Marseille'),
    ('Aurélie Petit', 'aurelie.petit@exemple.fr', 'Nantes'),
    ('Julien Moreau', 'julien.moreau@exemple.fr', 'Lille'),
    ('Sophie Dubois', 'sophie.dubois@exemple.fr', 'Toulouse');

insert into orders (customer_id, amount, status, order_date) values
    (1, 129.90, 'livree', current_date - 12),
    (1, 89.50, 'livree', current_date - 9),
    (2, 250.00, 'expediee', current_date - 7),
    (3, 45.30, 'en_preparation', current_date - 5),
    (3, 310.75, 'livree', current_date - 4),
    (4, 99.99, 'annulee', current_date - 3),
    (5, 175.20, 'livree', current_date - 2),
    (2, 62.40, 'en_preparation', current_date - 1),
    (5, 880.00, 'expediee', current_date - 1),
    (1, 33.10, 'livree', current_date);

-- Pour la validation incrémentale : les insertions suivantes ne portent que
-- les nouvelles lignes (commandes rejouées depuis la dernière exécution).
-- Exemple de delta à appliquer pendant le test :
--
--   insert into orders (customer_id, amount, status, order_date) values
--       (4, 120.00, 'en_preparation', current_date);
--   update customers set city = 'Bordeaux', updated_at = now()
--    where id = 3;
